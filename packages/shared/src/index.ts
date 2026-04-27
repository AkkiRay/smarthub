/**
 * @fileoverview Public barrel-export пакета `@smarthome/shared`.
 *
 * Всё что экспортится отсюда — видно одновременно renderer'у (Vue) и main
 * процессу Electron, плюс packages внутри monorepo. Импорты из глубины
 * (`@smarthome/shared/types/...`) запрещены — используйте только этот корень.
 *
 * Содержимое:
 *   - `constants/`  — Yandex Smart Home enum'ы, цветовые presets, default'ы.
 *   - `types/`      — domain-схема (Device, Driver, IPC, Scene, Alice payloads).
 *   - `utils/`      — pure helpers (color, capability-builders, type-guards,
 *                     Result-wrapper).
 */

export * from './constants/alice.js';
export * from './constants/capabilities.js';
export * from './constants/colors.js';
export * from './constants/labels.js';
export * from './types/device.js';
export * from './types/driver.js';
export * from './types/driver-credentials.js';
export * from './types/yandex-station.js';
export * from './types/alice.js';
export * from './types/ipc.js';
export * from './types/scene.js';
export * from './types/updater.js';
export * from './utils/result.js';
export * from './utils/capability-builders.js';
export * from './utils/type-guards.js';
export * from './utils/concurrency.js';
