/**
 * Контракт «описание + фабрика» для драйвера.
 *
 * Каждый драйвер экспортирует одну `DriverModule`-константу; регистрация нового =
 * импорт + строка в `DRIVER_MODULES` массиве (`driver-registry.ts`).
 */

import type { DeviceDriver, DriverDescriptor } from '@smarthome/shared';
import type { SettingsStore } from '../storage/settings-store.js';

export interface DriverModuleDeps {
  settings: SettingsStore;
}

export interface DriverModule {
  /** Метаданные для UI; видны даже если драйвер ещё не активирован. */
  descriptor: Omit<DriverDescriptor, 'active'>;
  /** Возвращает null, если creds не введены — тогда UI показывает «нужны учётные данные». */
  create(deps: DriverModuleDeps): Promise<DeviceDriver | null>;
}
