/**
 * @fileoverview Builder'ы {@link DeviceCommandResult} для драйверов, которые
 * не наследуются от {@link BaseDriver} (например, прокси-обёртки или
 * вспомогательные модули внутри драйверов).
 *
 * Базовый класс {@link BaseDriver} даёт `this.ok()` / `this.err()` через
 * protected-методы; здесь — функциональные эквиваленты для callers без
 * `this`-контекста.
 */

import type { CapabilityType, Device, DeviceCommand, DeviceCommandResult } from '@smarthome/shared';

/**
 * Curry'ёный err-builder: связывает device + command, возвращает функцию
 * `(code, message?) => DeviceCommandResult`. Удобно для длинных
 * if/else-цепочек внутри одного `execute()`.
 *
 * @example
 * ```ts
 * const err = buildErr(device, command);
 * if (!device.online) return err('OFFLINE');
 * if (command.value < 0) return err('VALIDATION', 'value must be >= 0');
 * ```
 */
export function buildErr(device: Device, command: DeviceCommand) {
  return (code: string, message?: string): DeviceCommandResult => ({
    deviceId: device.id,
    capability: command.capability,
    instance: command.instance,
    status: 'ERROR',
    errorCode: code,
    errorMessage: message,
  });
}

export function ok(
  device: Device,
  capability: CapabilityType,
  instance: string,
): DeviceCommandResult {
  return { deviceId: device.id, capability, instance, status: 'DONE' };
}
