import type { CapabilityType, Device, DeviceCommand, DeviceCommandResult } from '@smarthome/shared';

/** Стандартный errOf-builder, повторяется почти в каждом драйвере. */
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
