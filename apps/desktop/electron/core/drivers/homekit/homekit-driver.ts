// HomeKit Accessory Protocol (HAP) controller: discovery `_hap._tcp` через mDNS.
// Полный controller flow (PIN-pairing → SRP-3072 → Ed25519 long-term keys → HAP characteristics)
// требует hap-controller или hap-nodejs — большая зависимость. Здесь discovery + распознавание
// типа аксессуара по category-id, control возвращает CONTROLLER_MISSING (как Matter).

import { Bonjour } from 'bonjour-service';
import log from 'electron-log/main.js';
import type {
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceDriver,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';

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
    const bonjour = new Bonjour();
    const found = new Map<string, DiscoveredDevice>();
    const browser = bonjour.find({ type: 'hap', protocol: 'tcp' });

    browser.on('up', (svc) => {
      const host = svc.referer?.address ?? svc.host;
      if (!host) return;
      const txt = svc.txt ?? {};
      const ci = String(txt['ci'] ?? '');
      const sf = String(txt['sf'] ?? '0'); // sf=0 — paired (shared), sf=1 — unpaired discoverable
      const type = HAP_CATEGORIES[ci] ?? 'devices.types.other';
      found.set(svc.name, {
        driver: 'homekit',
        externalId: String(txt['id'] ?? svc.name),
        type,
        name: svc.name,
        address: `${host}:${svc.port ?? 0}`,
        meta: {
          categoryId: ci,
          paired: sf === '0',
          setupHash: txt['sh'],
          configNumber: txt['c#'],
        } satisfies HomeKitMeta,
      });
    });

    return await new Promise((resolve) => {
      const finish = (): void => {
        try {
          browser.stop();
          bonjour.destroy();
        } catch {
          /* stopped */
        }
        resolve(Array.from(found.values()));
      };
      const timer = setTimeout(finish, 3500);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        finish();
      });
    });
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
    log.warn('HomeKit: full HAP controller missing — install hap-controller for actual control.');
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
