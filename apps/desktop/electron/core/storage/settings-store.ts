/**
 * @fileoverview Encrypted key-value store (electron-store) — хранит
 * долгоживущие настройки и секреты:
 *
 *   - `hubId`            — UUID хаба, выдаётся при первом запуске.
 *   - `theme`            — light/dark/system, синхронизируется с UI store.
 *   - `driverCreds.<id>` — зашифрованные creds каждого driver'а
 *                           (см. {@link DriverCredentials}).
 *   - `alice.skillConfig`, `alice.exposures.*`, `alice.tokens.*` — всё про
 *     Alice Smart Home Skill bridge.
 *
 * Хранилище использует Electron `safeStorage` под капотом — на Windows это
 * DPAPI (per-user encryption), на macOS Keychain, на Linux libsecret.
 * Если safeStorage недоступен — данные сохраняются в plain (пользователь
 * получит warning при первом запуске).
 *
 * Расположение: `%APPDATA%/SmartHome Hub/config.json` (Windows),
 * аналогично на других ОС.
 */

import Store from 'electron-store';
import { app, safeStorage } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import log from 'electron-log/main.js';
import type {
  AliceDeviceExposure,
  AliceSceneExposure,
  AliceSkillConfig,
  DriverCredentials,
  DriverId,
} from '@smarthome/shared';

export interface YandexStationCreds {
  host: string;
  port: number;
  deviceId: string;
  /** Per-device JWT для wss://, ротируется ~ежечасно через `glagol/token`. */
  token: string;
  /** Epoch-секунды (`exp` claim из JWT). 0 если не удалось распарсить. */
  tokenExpiresAt?: number;
  /** SHA-256 fingerprint TLS-cert (TOFU pin). Mismatch → terminate connection. */
  certFingerprint?: string;
  platform?: string;
  name?: string;
}

/** OAuth Яндекс.Музыки для Quasar API. Живёт ~1 год. */
export interface QuasarAuthCreds {
  musicToken: string;
  /** Epoch-секунды; 0 если Yandex не прислал `expires_in`. */
  expiresAt: number;
}

/**
 * State Alice smart-home skill bridge.
 *
 * - `config` — что юзер ввёл из dialogs.yandex.ru (skill_id, OAuth creds).
 * - `*Exposures` — фильтр «какие устройства/сценарии Алиса видит».
 * - `issuedTokens` — bearer-токены, которые мы выдали Алисе на её OAuth-handshake;
 *   ключ — accessToken, ротация — через refresh_token.
 */
export interface AliceSkillState {
  config: AliceSkillConfig | null;
  /** xToken passport.yandex.ru — для авто-получения glagol-токенов skill'ом. */
  yandexXToken: string | null;
  /** deviceId → правила; отсутствие записи = exposed (default). */
  deviceExposures: Record<string, AliceDeviceExposure>;
  sceneExposures: Record<string, AliceSceneExposure>;
  issuedTokens: Record<
    string,
    {
      internalUserId: string;
      issuedAt: number;
      expiresAt: number;
      refreshToken?: string;
    }
  >;
}

export interface HubSettings {
  /** Стабильный hub UUID — генерируется при первом запуске. */
  hubId: string;
  /** Driver creds, encrypted at rest. */
  driverCredentials: Record<string, Record<string, unknown>>;
  yandexStation: YandexStationCreds | null;
  /** OAuth Я.Музыки для Quasar API. */
  quasarAuth: QuasarAuthCreds | null;
  /** Активный household; null — UI обязан спросить если households.length > 1. */
  selectedHouseholdId: string | null;
  /** householdId → network signatures (gatewayMac primary, SSID/subnet fallback). */
  householdNetworks: Record<
    string,
    Array<{
      gatewayMac?: string | null;
      ssid: string | null;
      subnet: string | null;
      detectedAt: string;
    }>
  >;
  /** Если true — yandex-iot execute разрешается с любой сети (remote control). */
  allowCloudControlOffNetwork: boolean;
  alice: AliceSkillState;
  ui: {
    theme: 'alice-dark' | 'alice-midnight';
    accent: string;
    reduceMotion: boolean;
  };
}

const defaults: HubSettings = {
  hubId: '',
  driverCredentials: {},
  yandexStation: null,
  quasarAuth: null,
  selectedHouseholdId: null,
  householdNetworks: {},
  allowCloudControlOffNetwork: false,
  alice: {
    config: null,
    yandexXToken: null,
    deviceExposures: {},
    sceneExposures: {},
    issuedTokens: {},
  },
  ui: {
    theme: 'alice-dark',
    accent: '#6852FF',
    reduceMotion: false,
  },
};

export type SettingsStore = Awaited<ReturnType<typeof createSettingsStore>>;

/** Hardcoded ключ предыдущих версий — только для one-shot миграции. */
const LEGACY_ENCRYPTION_KEY = 'smarthome-hub-local-key';
const KEY_FILE_NAME = '.store-key';

/**
 * Per-install random ключ, шифруется через `safeStorage` (DPAPI/Keychain/libsecret).
 *
 * Anti-data-loss policy:
 *   - Один transient DPAPI-сбой НЕ regener'ит ключ — это бы стёрло OAuth-токены,
 *     driver creds, выданные Алисе bearer'ы. Вместо этого throw'аем — main выйдет
 *     с диалогом «не удалось расшифровать профиль, перезапустите от того же пользователя»,
 *     юзер чинит OS-credstore-проблему вручную.
 *   - Если safeStorage недоступен (Linux без libsecret), startup отказываем целиком:
 *     plain-text-ключ на диске даёт false sense of security и не уважает NTFS-ACL.
 *     Юзер видит сообщение и решает (DESKTOP_SAFE_STORAGE_MISSING_OK=1 для CI/headless).
 */
function loadOrCreateEncryptionKey(): string {
  const keyPath = join(app.getPath('userData'), KEY_FILE_NAME);
  const safeStorageAvailable = safeStorage.isEncryptionAvailable();

  if (existsSync(keyPath)) {
    const buf = readFileSync(keyPath);
    if (safeStorageAvailable) {
      try {
        return safeStorage.decryptString(buf);
      } catch (e) {
        // Сохраняем сломанный файл рядом для post-mortem'а, не стираем.
        const backup = `${keyPath}.broken-${Date.now()}`;
        try {
          copyFileSync(keyPath, backup);
        } catch {
          /* fs gone? нечего сохранять */
        }
        log.error(
          `settings-store: safeStorage decrypt failed (saved ${backup}). Refusing to ` +
            `regenerate — that would wipe OAuth tokens and driver creds. Run as the same OS user.`,
          e,
        );
        throw new Error(
          'SmartHome Hub не может расшифровать ключ профиля. Запустите приложение от того же пользователя ОС.',
        );
      }
    }
    // safeStorage недоступен: legacy plaintext-ключ принимается one-shot ради миграции.
    log.warn(
      `settings-store: reading legacy plaintext key — рекомендуется переезд на ОС с DPAPI/Keychain/libsecret`,
    );
    return buf.toString('utf8');
  }

  // Свежий install / нет файла.
  if (!safeStorageAvailable) {
    if (process.env['HUB_SAFE_STORAGE_OPTIONAL'] === '1') {
      log.warn(
        `settings-store: safeStorage unavailable, HUB_SAFE_STORAGE_OPTIONAL=1 → plaintext key. Не для prod!`,
      );
      const key = randomBytes(32).toString('hex');
      writeFileSync(keyPath, key, { encoding: 'utf8', mode: 0o600 });
      return key;
    }
    throw new Error(
      'safeStorage недоступен (нет DPAPI/Keychain/libsecret). Установите libsecret или ' +
        'передайте HUB_SAFE_STORAGE_OPTIONAL=1 (только для dev).',
    );
  }
  const key = randomBytes(32).toString('hex');
  atomicWriteFile(keyPath, safeStorage.encryptString(key), { mode: 0o600 });
  return key;
}

/**
 * Atomic write через temp + rename: на crash либо старый файл остаётся целиком,
 * либо новый записан полностью. Без temp-rename мы получаем 0-byte файлы при
 * power loss / SIGKILL во время writeFileSync.
 */
function atomicWriteFile(
  path: string,
  data: string | Buffer,
  options: { encoding?: BufferEncoding; mode?: number } = {},
): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, data, options);
  try {
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* nothing to clean */
    }
    throw e;
  }
}

/** Перешифровывает `hub-settings.json` со старого hardcoded ключа на per-install. */
function migrateLegacyEncryptedSettings(newKey: string): void {
  const filePath = join(app.getPath('userData'), 'hub-settings.json');
  if (!existsSync(filePath)) return;

  let legacyData: HubSettings | null = null;
  try {
    const legacy = new Store<HubSettings>({
      name: 'hub-settings',
      defaults,
      encryptionKey: LEGACY_ENCRYPTION_KEY,
      clearInvalidConfig: false,
    });
    legacyData = legacy.store;
  } catch {
    return; // already migrated or corrupt — new Store ниже разберётся
  }
  // Без hubId это decrypt-by-chance на чистых defaults — не трогаем файл.
  if (!legacyData?.hubId) return;

  try {
    unlinkSync(filePath);
  } catch (e) {
    log.error('settings-store: failed to delete legacy file before migration', e);
    return;
  }
  const fresh = new Store<HubSettings>({
    name: 'hub-settings',
    defaults,
    encryptionKey: newKey,
  });
  for (const [k, v] of Object.entries(legacyData)) {
    fresh.set(k as keyof HubSettings, v as never);
  }
  log.info('settings-store: migrated from legacy hardcoded key to per-install key');
}

export async function createSettingsStore() {
  const encryptionKey = loadOrCreateEncryptionKey();
  migrateLegacyEncryptedSettings(encryptionKey);

  // clearInvalidConfig:false — иначе одна повреждённая запись (DPAPI hiccup,
  // обрыв питания при write) обнуляет всё: OAuth-токены, driver creds, выданные
  // Алисе bearer'ы. Лучше получить exception и помочь юзеру восстановить из backup'а,
  // чем тихо стереть.
  const store = new Store<HubSettings>({
    name: 'hub-settings',
    defaults,
    encryptionKey,
    clearInvalidConfig: false,
  });

  if (!store.get('hubId')) store.set('hubId', randomUUID());
  // Migration: electron-store не мерджит вложенные defaults для existing config'ов.
  if (!store.get('alice')) store.set('alice', defaults.alice);

  return {
    get: <K extends keyof HubSettings>(key: K): HubSettings[K] => store.get(key),
    set: <K extends keyof HubSettings>(key: K, value: HubSettings[K]): void => {
      store.set(key, value);
    },
    all: (): HubSettings => ({ ...store.store }),
    update(patch: Partial<HubSettings>): void {
      for (const [k, v] of Object.entries(patch)) {
        store.set(k as keyof HubSettings, v as never);
      }
    },
    setDriverCredentials<D extends DriverId>(driverId: D, creds: DriverCredentials<D>): void {
      const all = store.get('driverCredentials');
      store.set('driverCredentials', { ...all, [driverId]: creds });
    },
    /** `Partial`, т.к. required-поля могут быть пустые до ввода юзером. */
    getDriverCredentials<D extends DriverId>(driverId: D): Partial<DriverCredentials<D>> {
      const all = store.get('driverCredentials');
      return (all[driverId] ?? {}) as Partial<DriverCredentials<D>>;
    },
    // === Alice helpers ===
    getAlice(): AliceSkillState {
      return store.get('alice');
    },
    patchAlice(patch: Partial<AliceSkillState>): AliceSkillState {
      const next = { ...store.get('alice'), ...patch };
      store.set('alice', next);
      return next;
    },
    setDeviceExposure(exposure: AliceDeviceExposure): AliceSkillState {
      const alice = store.get('alice');
      const next: AliceSkillState = {
        ...alice,
        deviceExposures: { ...alice.deviceExposures, [exposure.deviceId]: exposure },
      };
      store.set('alice', next);
      return next;
    },
    setSceneExposure(exposure: AliceSceneExposure): AliceSkillState {
      const alice = store.get('alice');
      const next: AliceSkillState = {
        ...alice,
        sceneExposures: { ...alice.sceneExposures, [exposure.sceneId]: exposure },
      };
      store.set('alice', next);
      return next;
    },
  };
}
