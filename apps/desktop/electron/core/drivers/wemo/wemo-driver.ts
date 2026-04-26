/**
 * @fileoverview Belkin WeMo driver. Discovery — SSDP M-SEARCH `urn:Belkin:device:*`,
 * control — SOAP `/upnp/control/basicevent1`. XML парсим regexp'ом по
 * `<BinaryState>` и `<friendlyName>` (без зависимости от xml2js).
 */

import axios from 'axios';
import type {
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DiscoveredDevice,
} from '@smarthome/shared';
import { CAPABILITY, DEVICE_TYPE, INSTANCE, capOnOff } from '@smarthome/shared';
import { BaseDriver } from '../_shared/base-driver.js';
import { ssdpDiscover } from '../_shared/ssdp-discover.js';

const WEMO_DISCOVER_TIMEOUT_MS = 3000;
const WEMO_SETUP_TIMEOUT_MS = 2000;
const WEMO_SOAP_TIMEOUT_MS = 3000;

export class WemoDriver extends BaseDriver {
  readonly id = 'wemo' as const;
  readonly displayName = 'Belkin WeMo';

  async discover(signal: AbortSignal): Promise<DiscoveredDevice[]> {
    const found = new Map<string, DiscoveredDevice>();
    // setup.xml fetch'и накапливаются и выполняются после закрытия SSDP socket'а.
    const pendingFetches: Array<{ udn: string; loc: string }> = [];

    await ssdpDiscover({
      driverId: 'wemo',
      st: 'urn:Belkin:device:**',
      timeoutMs: WEMO_DISCOVER_TIMEOUT_MS,
      signal,
      onResponse: (text) => {
        const loc = /LOCATION:\s*([^\r\n]+)/i.exec(text)?.[1]?.trim();
        const usn = /USN:\s*([^\r\n]+)/i.exec(text)?.[1]?.trim();
        if (!loc || !usn) return;
        const udn = /uuid:[^:]+/i.exec(usn)?.[0];
        if (!udn || found.has(udn) || pendingFetches.some((p) => p.udn === udn)) return;
        pendingFetches.push({ udn, loc });
      },
    });

    // setup.xml у каждого кандидата параллельно — оттуда читаем friendlyName.
    await Promise.allSettled(
      pendingFetches.map(async ({ udn, loc }) => {
        try {
          const setup = await axios.get<string>(loc, {
            timeout: WEMO_SETUP_TIMEOUT_MS,
            responseType: 'text',
          });
          const friendly = /<friendlyName>([^<]+)<\/friendlyName>/.exec(setup.data)?.[1];
          const url = new URL(loc);
          found.set(udn, {
            driver: 'wemo',
            externalId: udn,
            type: DEVICE_TYPE.SOCKET,
            name: friendly ?? `WeMo ${url.host}`,
            address: `${url.hostname}:${url.port || '49153'}`,
            meta: { udn, friendly: friendly ?? '' },
          });
        } catch (e) {
          this.logWarn(`setup.xml fetch failed for ${loc}`, e);
        }
      }),
    );
    return Array.from(found.values());
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const now = new Date().toISOString();
    let on = false;
    try {
      on = await this.getBinaryState(candidate.address);
    } catch {
      /* keep offline state */
    }
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'wemo',
      type: DEVICE_TYPE.SOCKET,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      meta: candidate.meta,
      status: 'online',
      capabilities: [capOnOff(on)],
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      const on = await this.getBinaryState(device.address);
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: device.capabilities.map((c) =>
          c.type === CAPABILITY.ON_OFF ? { ...c, state: { instance: INSTANCE.ON, value: on } } : c,
        ),
      };
    } catch {
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    if (command.capability !== CAPABILITY.ON_OFF) {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }
    try {
      await this.setBinaryState(device.address, Boolean(command.value));
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  private async getBinaryState(address: string): Promise<boolean> {
    const xml = await this.soap(address, 'GetBinaryState', '');
    const v = /<BinaryState>(\d+)<\/BinaryState>/.exec(xml)?.[1];
    return v === '1';
  }

  private async setBinaryState(address: string, on: boolean): Promise<void> {
    await this.soap(address, 'SetBinaryState', `<BinaryState>${on ? 1 : 0}</BinaryState>`);
  }

  private async soap(address: string, action: string, body: string): Promise<string> {
    const url = `http://${address}/upnp/control/basicevent1`;
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body><u:${action} xmlns:u="urn:Belkin:service:basicevent:1">${body}</u:${action}></s:Body>
</s:Envelope>`;
    const r = await axios.post<string>(url, envelope, {
      timeout: WEMO_SOAP_TIMEOUT_MS,
      responseType: 'text',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: `"urn:Belkin:service:basicevent:1#${action}"`,
      },
    });
    return r.data;
  }
}
