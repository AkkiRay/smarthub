/**
 * Абстрактная база для всех драйверов.
 *
 * Даёт `ok` / `err` builders для `DeviceCommandResult` и id-prefixed логи.
 * `err` принимает либо строку, либо caught `unknown` — вытаскивает `.message` сама.
 */

import log from 'electron-log/main.js';
import type {
  CapabilityType,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceDriver,
  DiscoveredDevice,
  DriverId,
} from '@smarthome/shared';
import { getErrorMessage } from '@smarthome/shared';

export abstract class BaseDriver implements DeviceDriver {
  abstract readonly id: DriverId;
  abstract readonly displayName: string;

  abstract discover(signal: AbortSignal): Promise<DiscoveredDevice[]>;
  abstract probe(candidate: DiscoveredDevice): Promise<Device | null>;
  abstract readState(device: Device): Promise<Device>;
  abstract execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult>;

  /** Override при наличии state (sockets, timers). */
  async shutdown(): Promise<void> {}

  protected ok(device: Device, capability: CapabilityType, instance: string): DeviceCommandResult {
    return { deviceId: device.id, capability, instance, status: 'DONE' };
  }

  protected err(
    device: Device,
    command: DeviceCommand,
    code: string,
    messageOrError?: unknown,
  ): DeviceCommandResult {
    return {
      deviceId: device.id,
      capability: command.capability,
      instance: command.instance,
      status: 'ERROR',
      errorCode: code,
      errorMessage:
        messageOrError === undefined
          ? undefined
          : typeof messageOrError === 'string'
            ? messageOrError
            : getErrorMessage(messageOrError),
    };
  }

  protected logWarn(message: string, e?: unknown): void {
    log.warn(`[${this.id}] ${message}${e !== undefined ? ': ' + getErrorMessage(e) : ''}`);
  }

  protected logInfo(message: string): void {
    log.info(`[${this.id}] ${message}`);
  }
}
