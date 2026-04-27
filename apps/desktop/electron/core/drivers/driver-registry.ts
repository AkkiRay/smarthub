/**
 * @fileoverview Реестр драйверов — отвечает за lifecycle (init / reload /
 * shutdown), хранит UI-descriptors и instance'ы активных драйверов.
 *
 * Lazy-init pattern:
 *   - Driver'ы у которых `requiresCredentials: true` попадают в active-map
 *     ТОЛЬКО после того, как юзер сохранил creds через `setCredentials` →
 *     `reloadDriver` создаст instance.
 *   - Driver'ы без обязательных creds (mock, yeelight, lifx, wiz, shelly,
 *     wemo, generic-http, yandex-station, yandex-iot) активируются сразу.
 *   - Дисабленные через ENV (`HUB_DISABLE_<id>=true`) пропускаются.
 *
 * Регистрация нового driver'а:
 *   1. Реализовать `DriverModule` в `electron/core/drivers/<id>/module.ts`.
 *   2. Импортировать его сюда.
 *   3. Добавить в массив {@link DRIVER_MODULES}.
 *
 * Hot-reload (`reloadDriver(id)`):
 *   Используется при смене creds — корректно `shutdown()`'ит старый instance,
 *   создаёт новый с обновлёнными creds, эмитит событие в event bus.
 */

import { EventEmitter } from 'node:events';
import log from 'electron-log/main.js';
import type {
  DeviceDriver,
  DriverDescriptor,
  DriverId,
  DriverProbeResult,
} from '@smarthome/shared';
import type { SettingsStore } from '../storage/settings-store.js';
import type { DriverModule } from './driver-module.js';

import { yeelightModule } from './yeelight/module.js';
import { shellyModule } from './shelly/module.js';
import { tuyaModule } from './tuya/module.js';
import { mqttModule } from './mqtt/module.js';
import { genericHttpModule } from './generic-http/module.js';
import { mockModule } from './mock/module.js';
import { hueModule } from './hue/module.js';
import { lifxModule } from './lifx/module.js';
import { wizModule } from './wiz/module.js';
import { tplinkKasaModule } from './tplink-kasa/module.js';
import { tplinkTapoModule } from './tplink-tapo/module.js';
import { miioModule } from './miio/module.js';
import { dirigeraModule } from './dirigera/module.js';
import { wemoModule } from './wemo/module.js';
import { ewelinkModule } from './ewelink/module.js';
import { goveeModule } from './govee/module.js';
import { switchbotModule } from './switchbot/module.js';
import { homekitModule } from './homekit/module.js';
import { matterModule } from './matter/module.js';
import { mihomeCloudModule } from './mihome-cloud/module.js';
import { aqaraCloudModule } from './aqara-cloud/module.js';
import { sberHomeModule } from './sber-home/module.js';
import { saluteHomeModule } from './salute-home/module.js';
import { rubetekModule } from './rubetek/module.js';
import { tplinkCloudModule } from './tplink-cloud/module.js';
import { lifxCloudModule } from './lifx-cloud/module.js';
import { homeAssistantModule } from './home-assistant/module.js';
import { zwavejsModule } from './zwavejs/module.js';
import { yandexIotModule } from './yandex-iot/module.js';
import { yandexLampModule } from './yandex-lamp/module.js';

/** Полный список драйверов. UI группирует карточки по `descriptor.category`. */
const DRIVER_MODULES: readonly DriverModule[] = [
  // LAN
  yeelightModule,
  shellyModule,
  hueModule,
  lifxModule,
  wizModule,
  tplinkKasaModule,
  tplinkTapoModule,
  miioModule,
  dirigeraModule,
  wemoModule,
  // Cloud РФ/СНГ
  yandexIotModule,
  yandexLampModule,
  sberHomeModule,
  saluteHomeModule,
  rubetekModule,
  // Cloud глобал
  tuyaModule,
  ewelinkModule,
  goveeModule,
  switchbotModule,
  mihomeCloudModule,
  aqaraCloudModule,
  tplinkCloudModule,
  lifxCloudModule,
  // Bridges
  homeAssistantModule,
  zwavejsModule,
  // Protocols
  mqttModule,
  homekitModule,
  matterModule,
  // Misc
  genericHttpModule,
  mockModule,
];

export type DriverRegistry = ReturnType<typeof createDriverRegistry>;

interface DriverRegistryEvents {
  /** Driver instance замещён — consumers (device-registry push-wiring) должны
   *  переподписаться на новый instance. */
  'driver:reloaded': (driverId: DriverId) => void;
}

export function createDriverRegistry(deps: { settings: SettingsStore }) {
  const drivers = new Map<DriverId, DeviceDriver>();
  const emitter = new EventEmitter();
  // id → module для reloadDriver(); creds-driven модули инициализируются повторно.
  const modulesById = new Map<DriverId, DriverModule>(
    DRIVER_MODULES.map((m) => [m.descriptor.id, m]),
  );

  const initOne = async (module: DriverModule): Promise<void> => {
    try {
      const driver = await module.create({ settings: deps.settings });
      if (driver) drivers.set(driver.id, driver);
    } catch (e) {
      log.warn(`DriverRegistry: ${module.descriptor.id} init failed: ${(e as Error).message}`);
    }
  };

  return {
    async init(): Promise<void> {
      // Параллельная init с лимитом 4 — драйверы независимы, но full-Promise.all даёт
      // burst из ~30 одновременных HTTP/MQTT/SSDP-сокетов (Hue + Tuya + MQTT + cloud-rest).
      // На медленной сети это даёт каскад timeout'ов и DNS-флуд.
      const limit = (await import('p-limit')).default(4);
      await Promise.all(DRIVER_MODULES.map((m) => limit(() => initOne(m))));
      log.info(`DriverRegistry: ${drivers.size}/${DRIVER_MODULES.length} drivers active`);
    },

    /** Re-init одного драйвера после save credentials. Старый instance shutdown-ится.
     *  Эмитит `driver:reloaded` — consumers (device-registry push-wiring) переподписываются. */
    async reloadDriver(id: string): Promise<void> {
      const driverId = id as DriverId;
      const module = modulesById.get(driverId);
      if (!module) {
        log.warn(`reloadDriver: unknown driver id "${id}"`);
        return;
      }
      const old = drivers.get(driverId);
      if (old) {
        try {
          await old.shutdown();
        } catch (e) {
          log.warn(`reloadDriver: shutdown of ${id} failed: ${(e as Error).message}`);
        }
        drivers.delete(driverId);
      }
      await initOne(module);
      log.info(`DriverRegistry: reloaded ${id}`);
      emitter.emit('driver:reloaded', driverId);
    },

    on<E extends keyof DriverRegistryEvents>(
      event: E,
      listener: DriverRegistryEvents[E],
    ): () => void {
      emitter.on(event, listener as never);
      return () => emitter.off(event, listener as never);
    },

    /**
     * Light-probe credentials без save. Делегирует в `module.probe()`. Если
     * у модуля нет probe — возвращает «не реализовано» — UI сам решит, что
     * показать (обычно «попробуйте сохранить и подождать первого ответа»).
     */
    async testCredentials(id: string, values: Record<string, string>): Promise<DriverProbeResult> {
      const driverId = id as DriverId;
      const module = modulesById.get(driverId);
      if (!module) {
        return { ok: false, message: `Драйвер «${id}» не зарегистрирован` };
      }
      if (typeof module.probe !== 'function') {
        return {
          ok: false,
          message:
            'У этого драйвера пока нет проверки. Сохраните и попробуйте обнаружить устройства.',
        };
      }
      try {
        return await module.probe(values, { settings: deps.settings });
      } catch (e) {
        const msg = (e as Error).message ?? 'Неизвестная ошибка';
        log.warn(`testCredentials(${id}) threw: ${msg}`);
        return { ok: false, message: msg };
      }
    },

    list: (): DeviceDriver[] => Array.from(drivers.values()),

    descriptors: (): DriverDescriptor[] =>
      DRIVER_MODULES.map((m) => ({
        ...m.descriptor,
        active: drivers.has(m.descriptor.id),
      })),

    get: (id: DriverId): DeviceDriver | null => drivers.get(id) ?? null,

    require(id: DriverId): DeviceDriver {
      const d = drivers.get(id);
      if (!d) throw new Error(`Driver ${id} is not registered`);
      return d;
    },

    async shutdown(): Promise<void> {
      await Promise.allSettled(Array.from(drivers.values()).map((d) => d.shutdown()));
      drivers.clear();
    },
  };
}
