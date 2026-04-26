/**
 * Реестр драйверов: lifecycle (init / reload / shutdown) и UI-descriptors.
 *
 * Lazy-init: драйверы с обязательными credentials попадают в map только после
 * `setCredentials → reloadDriver`. Регистрация нового драйвера — строка в `DRIVER_MODULES`.
 */

import log from 'electron-log/main.js';
import type { DeviceDriver, DriverDescriptor, DriverId } from '@smarthome/shared';
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

export function createDriverRegistry(deps: { settings: SettingsStore }) {
  const drivers = new Map<DriverId, DeviceDriver>();
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
      // Параллельная init — драйверы независимы, последовательная съедает ~2-3s старта.
      await Promise.all(DRIVER_MODULES.map(initOne));
      log.info(`DriverRegistry: ${drivers.size}/${DRIVER_MODULES.length} drivers active`);
    },

    /** Re-init одного драйвера после save credentials. Старый instance shutdown-ится. */
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
