import axios, { type AxiosInstance } from 'axios';
import type {
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceDriver,
  DiscoveredDevice,
} from '@smarthome/shared';

/**
 * Generic HTTP driver — для устройств с простым REST endpoint. Конфиг в `device.meta`:
 *   statusUrl (GET → `{ on: boolean }` или строка on/off), onUrl, offUrl, method?, bearer?.
 */
export class GenericHttpDriver implements DeviceDriver {
  readonly id = 'generic-http' as const;
  readonly displayName = 'Generic HTTP';

  private readonly http: AxiosInstance = axios.create({ timeout: 4000 });

  async discover(): Promise<DiscoveredDevice[]> {
    return [];
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const now = new Date().toISOString();
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'generic-http',
      type: candidate.type,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      status: 'online',
      meta: candidate.meta,
      capabilities: [
        {
          type: 'devices.capabilities.on_off',
          retrievable: true,
          reportable: false,
          state: { instance: 'on', value: false },
        },
      ],
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    const meta = device.meta as { statusUrl?: string; bearer?: string };
    if (!meta.statusUrl) return device;
    try {
      const { data } = await this.http.get(meta.statusUrl, {
        headers: meta.bearer ? { Authorization: `Bearer ${meta.bearer}` } : undefined,
      });
      const on =
        typeof data === 'boolean'
          ? data
          : typeof data === 'string'
            ? /^(on|true|1)$/i.test(data.trim())
            : Boolean((data as { on?: boolean }).on);
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: device.capabilities.map((c) =>
          c.type === 'devices.capabilities.on_off'
            ? { ...c, state: { instance: 'on', value: on } }
            : c,
        ),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const meta = device.meta as {
      onUrl?: string;
      offUrl?: string;
      method?: 'GET' | 'POST';
      bearer?: string;
    };
    if (command.capability !== 'devices.capabilities.on_off' || !meta.onUrl || !meta.offUrl) {
      return {
        deviceId: device.id,
        capability: command.capability,
        instance: command.instance,
        status: 'ERROR',
        errorCode: 'UNSUPPORTED_CAPABILITY',
      };
    }
    try {
      const url = command.value ? meta.onUrl : meta.offUrl;
      const method = meta.method ?? 'GET';
      await this.http.request({
        url,
        method,
        headers: meta.bearer ? { Authorization: `Bearer ${meta.bearer}` } : undefined,
      });
      return {
        deviceId: device.id,
        capability: command.capability,
        instance: command.instance,
        status: 'DONE',
      };
    } catch (e) {
      return {
        deviceId: device.id,
        capability: command.capability,
        instance: command.instance,
        status: 'ERROR',
        errorCode: 'DEVICE_UNREACHABLE',
        errorMessage: (e as Error).message,
      };
    }
  }

  async shutdown() {
    /* stateless */
  }
}
