/** Encrypted key-value store (electron-store): hubId, theme, driver creds, Alice skill state. */

import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
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

export async function createSettingsStore() {
  const store = new Store<HubSettings>({
    name: 'hub-settings',
    defaults,
    // Обфускация, не криптография — защита от случайного шаринга конфига.
    // TODO: вынести в per-install secret через keytar / OS keychain.
    encryptionKey: 'smarthome-hub-local-key',
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
