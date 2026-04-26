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
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
  /** householdId → list of network signatures (SSID/subnet) для авто-выбора по сети. */
  householdNetworks: Record<
    string,
    Array<{ ssid: string | null; subnet: string | null; detectedAt: string }>
  >;
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

/** Per-install random ключ, шифруется через `safeStorage` (DPAPI/Keychain/libsecret). */
function loadOrCreateEncryptionKey(): string {
  const keyPath = join(app.getPath('userData'), KEY_FILE_NAME);
  if (existsSync(keyPath)) {
    const buf = readFileSync(keyPath);
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(buf);
      } catch (e) {
        log.error('settings-store: safeStorage decrypt failed — regenerating key', e);
        // fallthrough к регенерации
      }
    } else {
      return buf.toString('utf8');
    }
  }
  const key = randomBytes(32).toString('hex');
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(keyPath, safeStorage.encryptString(key), { mode: 0o600 });
  } else {
    log.warn(`settings-store: safeStorage unavailable — key written plaintext at ${keyPath}`);
    writeFileSync(keyPath, key, { encoding: 'utf8', mode: 0o600 });
  }
  return key;
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

  const store = new Store<HubSettings>({
    name: 'hub-settings',
    defaults,
    encryptionKey,
    clearInvalidConfig: true,
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
