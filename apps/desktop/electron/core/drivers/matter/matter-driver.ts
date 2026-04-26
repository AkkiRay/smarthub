// Matter-over-IP: discovery через mDNS-SD `_matter._tcp` / `_matterc._udp` (commissionable).
// Полный controller stack (commissioning, PASE, CASE, attribute read/subscribe) требует
// `@project-chip/matter.js` + native crypto — это ~10 MB зависимостей. Здесь реализован только
// pass-through discovery: пользователь видит свои Matter-устройства, а UI показывает «для управления
// требуется установить Matter Controller». Полная реализация — отдельная фича после поставки.

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

interface MatterMeta extends Record<string, unknown> {
  vendorId?: string;
  productId?: string;
  deviceType?: string;
  longDiscriminator?: string;
  shortDiscriminator?: string;
  commissioningMode?: string;
  rotatingId?: string;
  pairingHint?: string;
  /** true — устройство ещё не commissioned (commissionable advertise '_matterc'). */
  commissionable: boolean;
}

const MATTER_DEVICE_TYPES: Record<string, DeviceType> = {
  // CHIP device-type-id (десятичный, hex в TXT записи) → каноническая категория.
  '256': 'devices.types.light', // OnOff Light
  '257': 'devices.types.light', // Dimmable Light
  '258': 'devices.types.light', // Color Temperature Light
  '268': 'devices.types.light', // Extended Color Light
  '266': 'devices.types.socket', // OnOff Plug-in Unit
  '267': 'devices.types.socket', // Dimmable Plug-in Unit
  '770': 'devices.types.sensor', // Temperature Sensor
  '775': 'devices.types.sensor', // Humidity Sensor
  '107': 'devices.types.fan',
  '769': 'devices.types.thermostat',
  '772': 'devices.types.sensor', // Pressure Sensor
};

export class MatterDriver implements DeviceDriver {
  readonly id = 'matter' as const;
  readonly displayName = 'Matter (Discovery)';

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    const bonjour = new Bonjour();
    const found = new Map<string, DiscoveredDevice>();

    const handle = (
      svc: {
        name: string;
        host?: string;
        port?: number;
        txt?: Record<string, string>;
        referer?: { address: string };
      },
      commissionable: boolean,
    ): void => {
      const host = svc.referer?.address ?? svc.host;
      if (!host) return;
      const txt = svc.txt ?? {};
      const dt = parseInt(txt['DT'] ?? '0', 16) || Number(txt['DT'] ?? 0);
      const type = MATTER_DEVICE_TYPES[String(dt)] ?? 'devices.types.other';
      found.set(svc.name, {
        driver: 'matter',
        externalId: svc.name,
        type,
        name: txt['DN'] ?? svc.name,
        address: `${host}:${svc.port ?? 5540}`,
        meta: {
          vendorId: txt['VID'],
          productId: txt['PID'],
          deviceType: txt['DT'],
          longDiscriminator: txt['D'],
          shortDiscriminator: txt['SD'],
          commissioningMode: txt['CM'],
          rotatingId: txt['RI'],
          pairingHint: txt['PH'],
          commissionable,
        } satisfies MatterMeta,
      });
    };

    const browserOperational = bonjour.find({ type: 'matter', protocol: 'tcp' });
    const browserCommissionable = bonjour.find({ type: 'matterc', protocol: 'udp' });
    browserOperational.on('up', (s) => handle(s, false));
    browserCommissionable.on('up', (s) => handle(s, true));

    return await new Promise((resolve) => {
      const finish = (): void => {
        try {
          browserOperational.stop();
          browserCommissionable.stop();
          bonjour.destroy();
        } catch {
          /* already stopped */
        }
        resolve(Array.from(found.values()));
      };
      const timer = setTimeout(finish, 4000);
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
      driver: 'matter',
      type: candidate.type,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      status: 'online',
      meta: candidate.meta,
      // Без CHIP-controller'а capabilities = только onOff status placeholder.
      // После установки @project-chip/matter.js здесь будет attribute subscription.
      capabilities: [
        {
          type: 'devices.capabilities.on_off',
          retrievable: false,
          reportable: false,
        },
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
    log.warn(
      'Matter: control requires @project-chip/matter.js controller — install it and re-init driver.',
    );
    return {
      deviceId: device.id,
      capability: command.capability,
      instance: command.instance,
      status: 'ERROR',
      errorCode: 'CONTROLLER_MISSING',
      errorMessage:
        'Matter-control пока в режиме discovery. Установите @project-chip/matter.js для полного управления.',
    };
  }

  async shutdown(): Promise<void> {
    /* stateless */
  }
}
