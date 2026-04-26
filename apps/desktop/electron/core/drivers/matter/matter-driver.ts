/**
 * @fileoverview Matter-over-IP discovery: mDNS-SD `_matter._tcp` (operational)
 * + `_matterc._udp` (commissionable). Driver реализует только discovery;
 * `execute()` возвращает `CONTROLLER_MISSING` до установки `@project-chip/matter.js`.
 *
 * TXT schema (Matter Core Spec 1.x §4.3, App Spec §5.4.2):
 *   _matterc._udp:
 *     D    Discriminator (12-bit, decimal либо hex)
 *     SD   Short Discriminator (4-bit)
 *     CM   Commissioning Mode: 0=closed, 1=passcode, 2=basic
 *     VP   `vendorId+productId`, "0xFFF1+0x8000" либо "65521+32768"
 *     DT   Device Type ID (256 = OnOff Light, etc.)
 *     DN   Friendly Device Name (UTF-8)
 *     RI   Rotating Identifier
 *     PH   Pairing Hint bitmap
 *     PI   Pairing Instruction
 *   _matter._tcp:
 *     SII/SAI/SAT  sleepy/active intervals
 *     T            TCP support bitmap
 *     ICD          Intermittently Connected Device class
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

interface MatterMeta extends Record<string, unknown> {
  vendorId?: string;
  productId?: string;
  deviceType?: string;
  longDiscriminator?: string;
  shortDiscriminator?: string;
  commissioningMode?: string;
  rotatingId?: string;
  pairingHint?: string;
  pairingInstruction?: string;
  /** true для устройств, ещё не commissioned (анонсируют `_matterc._udp`). */
  commissionable: boolean;
}

/** CHIP device-type-id → канонический `DeviceType`. */
const MATTER_DEVICE_TYPES: Record<string, DeviceType> = {
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
  '15': 'devices.types.sensor', // Generic Switch
  '113': 'devices.types.openable', // Window Covering
  '40': 'devices.types.openable', // Door Lock
  '835': 'devices.types.sensor', // Air Quality Sensor
};

/** Нормализует TXT-значение `DT` из hex (`"0x100"`) либо decimal (`"256"`) в decimal-строку. */
function parseDtId(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const n = trimmed.toLowerCase().startsWith('0x')
    ? parseInt(trimmed, 16)
    : Number(trimmed);
  return Number.isFinite(n) ? String(n) : null;
}

export class MatterDriver implements DeviceDriver {
  readonly id = 'matter' as const;
  readonly displayName = 'Matter (Discovery)';

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    const [operational, commissionable] = await Promise.all([
      browseMdns({ type: 'matter', protocol: 'tcp', timeoutMs: 7000, signal }),
      browseMdns({ type: 'matterc', protocol: 'udp', timeoutMs: 7000, signal }),
    ]);

    const found = new Map<string, DiscoveredDevice>();
    const handle = (
      svc: { name: string; host: string; port: number; txt: Record<string, string> },
      isCommissionable: boolean,
    ): void => {
      const txt = svc.txt;
      const dtId = parseDtId(txt['DT']);
      const type = dtId
        ? (MATTER_DEVICE_TYPES[dtId] ?? 'devices.types.other')
        : 'devices.types.other';
      const friendly = txt['DN']?.trim() || svc.name;
      const vp = txt['VP']?.split('+');
      const vendorId = vp?.[0];
      const productId = vp?.[1];

      found.set(svc.name, {
        driver: 'matter',
        externalId: svc.name,
        type,
        name: friendly,
        address: `${svc.host}:${svc.port || 5540}`,
        meta: {
          ...(vendorId ? { vendorId } : {}),
          ...(productId ? { productId } : {}),
          ...(dtId ? { deviceType: dtId } : {}),
          ...(txt['D'] ? { longDiscriminator: txt['D'] } : {}),
          ...(txt['SD'] ? { shortDiscriminator: txt['SD'] } : {}),
          ...(txt['CM'] ? { commissioningMode: txt['CM'] } : {}),
          ...(txt['RI'] ? { rotatingId: txt['RI'] } : {}),
          ...(txt['PH'] ? { pairingHint: txt['PH'] } : {}),
          ...(txt['PI'] ? { pairingInstruction: txt['PI'] } : {}),
          commissionable: isCommissionable,
        } satisfies MatterMeta,
      });
    };

    for (const svc of operational) handle(svc, false);
    for (const svc of commissionable) handle(svc, true);

    log.info(
      `matter: ${found.size} accessories (operational=${operational.length}, commissionable=${commissionable.length})`,
    );
    return Array.from(found.values());
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
    log.warn('matter: execute requires @project-chip/matter.js controller');
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
