/**
 * @fileoverview HomeKit Accessory Protocol (HAP) discovery через mDNS
 * `_hap._tcp`. Driver реализует только discovery + классификацию по
 * category-id; `execute()` возвращает `CONTROLLER_MISSING` до установки
 * `hap-controller`.
 *
 * TXT schema (HAP spec § 6.4):
 *   id   accessory ID (MAC-формат `aa:bb:cc:dd:ee:ff`)
 *   ci   category id (см. `HAP_CATEGORIES`)
 *   sf   status flags (uint): bit0=1 → не сопряжён (pairing required),
 *        bit0=0 → сопряжён. Остальные биты — software/hardware-issues,
 *        не влияют на pairing-статус. Поэтому проверяем именно bit0,
 *        а не равенство '0' — sf может быть '4' (бит2 set), но всё ещё paired.
 *   sh   setup hash
 *   c#   config number (incrementится при изменении схемы)
 */

import log from 'electron-log/main.js';
import type {
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceDriver,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';
import { browseMdns } from '../_shared/mdns-browse.js';

const HAP_CATEGORIES: Record<string, DeviceType> = {
  '5': 'devices.types.light',
  '7': 'devices.types.switch',
  '8': 'devices.types.socket',
  '10': 'devices.types.fan',
  '17': 'devices.types.sensor',
  '21': 'devices.types.camera',
  '6': 'devices.types.thermostat',
  '20': 'devices.types.openable.curtain',
  '23': 'devices.types.purifier',
  '28': 'devices.types.humidifier',
  '32': 'devices.types.lock',
};

interface HomeKitMeta extends Record<string, unknown> {
  categoryId: string;
  paired: boolean;
  setupHash?: string;
  configNumber?: string;
}

export class HomeKitDriver implements DeviceDriver {
  readonly id = 'homekit' as const;
  readonly displayName = 'HomeKit (Discovery)';

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    const services = await browseMdns({
      type: 'hap',
      protocol: 'tcp',
      timeoutMs: 5000,
      signal,
    });
    const found = new Map<string, DiscoveredDevice>();
    for (const svc of services) {
      const txt = svc.txt;
      const ci = String(txt['ci'] ?? '');
      const sfRaw = String(txt['sf'] ?? '0');
      const sfNum = Number.parseInt(sfRaw, 10);
      const sfBits = Number.isFinite(sfNum) ? sfNum : 0;
      const type = HAP_CATEGORIES[ci] ?? 'devices.types.other';
      found.set(svc.name, {
        driver: 'homekit',
        externalId: String(txt['id'] ?? svc.name),
        type,
        name: svc.name,
        address: `${svc.host}:${svc.port ?? 0}`,
        meta: {
          categoryId: ci,
          paired: (sfBits & 1) === 0,
          ...(txt['sh'] ? { setupHash: txt['sh'] } : {}),
          ...(txt['c#'] ? { configNumber: txt['c#'] } : {}),
        } satisfies HomeKitMeta,
      });
    }
    log.info(`homekit: ${found.size} accessories on LAN`);
    return Array.from(found.values());
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const now = new Date().toISOString();
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'homekit',
      type: candidate.type,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      meta: candidate.meta,
      status: 'online',
      capabilities: [
        { type: 'devices.capabilities.on_off', retrievable: false, reportable: false },
      ],
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    return device;
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    log.warn('homekit: execute requires hap-controller package');
    return {
      deviceId: device.id,
      capability: command.capability,
      instance: command.instance,
      status: 'ERROR',
      errorCode: 'CONTROLLER_MISSING',
      errorMessage:
        'HomeKit-control пока в режиме discovery. Установите hap-controller для полного управления.',
    };
  }

  async shutdown(): Promise<void> {
    /* stateless */
  }
}
