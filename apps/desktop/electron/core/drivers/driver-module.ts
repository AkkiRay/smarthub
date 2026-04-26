/**
 * @fileoverview Контракт {@link DriverModule} — каждый driver экспортирует
 * одну константу этого типа.
 *
 * `DriverModule` отделяет **описание** (для UI marketplace, validation,
 * lazy-init) от **фабрики** (создание instance'а с подставленными creds).
 *
 * Регистрация нового driver'а:
 *   1. Создать `DriverModule` константу в `<id>/module.ts`.
 *   2. Импортировать её в `driver-registry.ts`.
 *   3. Добавить в массив `DRIVER_MODULES`.
 *
 * Фабрика `create({ settings })`:
 *   - Запрашивает у `settings` свои creds (`settings.getDriverCredentials<id>(id)`).
 *   - Возвращает `null` если creds невалидны / отсутствуют (driver останется
 *     в дисабленном состоянии, в UI — «Настройте credentials»).
 *   - Возвращает {@link DeviceDriver} instance, который registry зарегистрирует.
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
