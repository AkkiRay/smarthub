// Z-Wave-JS WebSocket bridge — подключаемся к WS-server (zwave-js-ui), читаем nodes,
// отправляем CC commands. Документация: https://zwave-js.github.io/zwave-js-server/.
//
// Минимальная реализация: ws://host:3000 → schema-cmd "start_listening" → events "node_added"/"value_updated".

import { WebSocket } from 'ws';
import type {
  Capability,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';
import { CAPABILITY, DEVICE_TYPE, INSTANCE } from '@smarthome/shared';
import { capBrightness, capOnOff } from '@smarthome/shared';
import { BaseDriver } from '../_shared/base-driver.js';

interface ZWaveCreds {
  url: string;
}

interface ZWaveNode {
  nodeId: number;
  name?: string;
  productLabel?: string;
  manufacturer?: string;
  deviceClass?: { genericDeviceClass?: string };
  values: Record<string, ZWaveValue>;
}

interface ZWaveValue {
  commandClass: number;
  property: string | number;
  value: unknown;
}

export class ZWaveJsDriver extends BaseDriver {
  readonly id = 'zwavejs' as const;
  readonly displayName = 'Z-Wave-JS';

  private ws: WebSocket | null = null;
  private nextMsgId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private nodes = new Map<number, ZWaveNode>();

  constructor(private readonly creds: ZWaveCreds) {
    super();
  }

  async discover(): Promise<DiscoveredDevice[]> {
    try {
      await this.connect();
      const out: DiscoveredDevice[] = [];
      for (const node of this.nodes.values()) {
        if (node.nodeId === 1) continue; // controller сам по себе
        out.push({
          driver: 'zwavejs',
          externalId: String(node.nodeId),
          type: mapClass(node.deviceClass?.genericDeviceClass),
          name: node.name ?? node.productLabel ?? `Z-Wave node ${node.nodeId}`,
          address: this.creds.url,
          meta: {
            nodeId: node.nodeId,
            manufacturer: node.manufacturer,
            productLabel: node.productLabel,
          },
        });
      }
      return out;
    } catch (e) {
      this.logWarn('discovery failed', e);
      return [];
    }
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const node = this.nodes.get(Number(candidate.externalId));
    const now = new Date().toISOString();
    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'zwavejs',
      type: candidate.type,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      status: 'online',
      meta: candidate.meta,
      capabilities: buildCaps(candidate.type, node),
      properties: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    const node = this.nodes.get(Number(device.externalId));
    if (!node) return { ...device, status: 'unreachable' };
    return {
      ...device,
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      capabilities: buildCaps(device.type, node),
    };
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const nodeId = Number(device.externalId);

    let cc = 0;
    let property: string | number = '';
    let value: unknown = null;
    if (command.capability === CAPABILITY.ON_OFF) {
      cc = 37; // SWITCH_BINARY
      property = 'targetValue';
      value = Boolean(command.value);
    } else if (
      command.capability === CAPABILITY.RANGE &&
      command.instance === INSTANCE.BRIGHTNESS
    ) {
      cc = 38; // SWITCH_MULTILEVEL
      property = 'targetValue';
      value = Math.max(1, Math.min(99, Number(command.value)));
    } else {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }

    try {
      await this.send({
        command: 'node.set_value',
        nodeId,
        valueId: { commandClass: cc, property },
        value,
      });
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  override async shutdown(): Promise<void> {
    this.ws?.close();
    this.ws = null;
    this.pending.clear();
  }

  private async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.creds.url);
      this.ws = ws;
      ws.on('open', async () => {
        try {
          await this.send({ command: 'set_api_schema', schemaVersion: 35 });
          const r = await this.send<{ state: { nodes: ZWaveNode[] } }>({
            command: 'start_listening',
          });
          for (const n of r.state.nodes) this.nodes.set(n.nodeId, n);
          resolve();
        } catch (e) {
          reject(e as Error);
        }
      });
      ws.on('message', (raw) => this.onMessage(raw.toString('utf8')));
      ws.on('error', (e) => {
        reject(e);
      });
      ws.on('close', () => {
        this.ws = null;
      });
    });
  }

  private send<T = unknown>(payload: object): Promise<T> {
    if (!this.ws) return Promise.reject(new Error('Z-Wave-JS WS not connected'));
    const messageId = this.nextMsgId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(messageId, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(JSON.stringify({ ...payload, messageId }));
      setTimeout(() => {
        if (this.pending.has(messageId)) {
          this.pending.delete(messageId);
          reject(new Error('Z-Wave-JS timeout'));
        }
      }, 5000);
    });
  }

  private onMessage(text: string): void {
    try {
      const obj = JSON.parse(text) as {
        type?: string;
        messageId?: number;
        success?: boolean;
        result?: unknown;
        errorCode?: string;
        event?: { source: string; event: string; nodeId?: number; args?: unknown };
      };
      if (obj.type === 'result' && typeof obj.messageId === 'number') {
        const p = this.pending.get(obj.messageId);
        if (!p) return;
        this.pending.delete(obj.messageId);
        if (obj.success) p.resolve(obj.result ?? {});
        else p.reject(new Error(obj.errorCode ?? 'unknown'));
      } else if (obj.type === 'event' && obj.event?.source === 'node') {
        // value_updated → patch nodes cache. Минимально, без полного state-sync.
        const nodeId = obj.event.nodeId;
        if (typeof nodeId !== 'number') return;
        const node = this.nodes.get(nodeId);
        if (!node) return;
        if (obj.event.event === 'value updated' && obj.event.args) {
          const v = obj.event.args as ZWaveValue & { newValue?: unknown };
          const key = `${v.commandClass}-${v.property}`;
          node.values[key] = {
            commandClass: v.commandClass,
            property: v.property,
            value: v.newValue,
          };
        }
      }
    } catch {
      /* malformed */
    }
  }
}

function mapClass(cls?: string): DeviceType {
  switch (cls) {
    case 'Binary Switch':
      return DEVICE_TYPE.SOCKET;
    case 'Multilevel Switch':
    case 'Light':
      return DEVICE_TYPE.LIGHT;
    case 'Multilevel Sensor':
    case 'Binary Sensor':
      return DEVICE_TYPE.SENSOR;
    case 'Thermostat':
      return DEVICE_TYPE.THERMOSTAT;
    case 'Entry Control':
      return DEVICE_TYPE.LOCK;
    default:
      return DEVICE_TYPE.OTHER;
  }
}

function buildCaps(type: DeviceType, node: ZWaveNode | undefined): Capability[] {
  const onValue = node?.values['37-currentValue']?.value;
  const dimValue = node?.values['38-currentValue']?.value;
  const isOn = Boolean(onValue) || (typeof dimValue === 'number' && dimValue > 0);
  const caps: Capability[] = [capOnOff(isOn)];
  if (type === DEVICE_TYPE.LIGHT && typeof dimValue === 'number') {
    caps.push(capBrightness(Math.max(1, dimValue)));
  }
  return caps;
}
