// Симулятор устройств для UI-отладки без железа (HUB_ENABLE_MOCK=true).
// State держится in-memory — теряется после reload by design.

import type {
  Capability,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceProperty,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';
import {
  DEVICE_TYPE,
  INSTANCE,
  RANGE,
  UNIT,
  capBrightness,
  capColor,
  capMode,
  capOnOff,
  capTemperatureRange,
  propFloat,
} from '@smarthome/shared';
import { BaseDriver } from '../_shared/base-driver.js';

interface MockDevicePreset {
  externalId: string;
  type: DeviceType;
  name: string;
  capabilities: Capability[];
  properties?: DeviceProperty[];
}

const PRESETS: readonly MockDevicePreset[] = [
  {
    externalId: 'mock-bulb-1',
    type: DEVICE_TYPE.LIGHT,
    name: 'Mock RGB-лампа',
    capabilities: [
      capOnOff(true),
      capBrightness(80),
      capColor({ kind: 'rgb', value: 0xa961ff }, { rgb: true, temperatureK: RANGE.KELVIN_DEFAULT }),
    ],
  },
  {
    externalId: 'mock-bulb-2',
    type: DEVICE_TYPE.LIGHT,
    name: 'Mock белая лампа',
    capabilities: [capOnOff(false), capBrightness(60)],
  },
  {
    externalId: 'mock-socket-1',
    type: DEVICE_TYPE.SOCKET,
    name: 'Mock розетка',
    capabilities: [capOnOff(false)],
  },
  {
    externalId: 'mock-thermostat-1',
    type: DEVICE_TYPE.THERMOSTAT,
    name: 'Mock термостат',
    capabilities: [
      capOnOff(true),
      capTemperatureRange(22),
      capMode(INSTANCE.THERMOSTAT, ['auto', 'heat', 'cool', 'off'], 'auto'),
    ],
  },
  {
    externalId: 'mock-sensor-1',
    type: DEVICE_TYPE.SENSOR,
    name: 'Mock датчик климата',
    capabilities: [],
    properties: [
      propFloat(INSTANCE.TEMPERATURE, 21.4, UNIT.TEMPERATURE_C),
      propFloat(INSTANCE.HUMIDITY, 47, UNIT.PERCENT),
      propFloat(INSTANCE.BATTERY_LEVEL, 92, UNIT.PERCENT),
    ],
  },
];

export class MockDriver extends BaseDriver {
  readonly id = 'mock' as const;
  readonly displayName = 'Mock-симулятор';

  // execute мутирует state именно здесь, чтобы readState отдавал актуальную картину.
  private readonly state = new Map<string, { caps: Capability[]; props: DeviceProperty[] }>();

  constructor() {
    super();
    for (const p of PRESETS) {
      this.state.set(p.externalId, {
        caps: cloneDeep(p.capabilities),
        props: cloneDeep(p.properties ?? []),
      });
    }
    this.logInfo(`initialized with ${PRESETS.length} presets`);
  }

  // signal в сигнатуре только ради DeviceDriver-контракта — mock синхронен, отменять нечего.
  async discover(_signal: AbortSignal): Promise<DiscoveredDevice[]> {
    return PRESETS.map<DiscoveredDevice>((p) => ({
      driver: 'mock',
      externalId: p.externalId,
      type: p.type,
      name: p.name,
      address: 'mock://local',
      meta: {},
    }));
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const preset = PRESETS.find((p) => p.externalId === candidate.externalId);
    if (!preset) {
      this.logWarn(`probe: unknown externalId=${candidate.externalId}`);
      return null;
    }
    const live = this.state.get(preset.externalId);
    const now = new Date().toISOString();
    return {
      // id оставляем пустым — DeviceRegistry присвоит UUID при pair'е.
      id: '',
      externalId: preset.externalId,
      driver: 'mock',
      type: preset.type,
      name: candidate.name || preset.name,
      address: candidate.address,
      hidden: false,
      status: 'online',
      meta: {},
      capabilities: cloneDeep(live?.caps ?? preset.capabilities),
      properties: cloneDeep(live?.props ?? preset.properties ?? []),
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    const live = this.state.get(device.externalId);
    if (!live) return { ...device, status: 'unreachable' };
    return {
      ...device,
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      capabilities: cloneDeep(live.caps),
      properties: cloneDeep(live.props),
    };
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const live = this.state.get(device.externalId);
    if (!live) {
      this.logWarn(`execute: device ${device.externalId} not in state (unreachable mock)`);
      return this.err(device, command, 'DEVICE_NOT_FOUND');
    }
    live.caps = live.caps.map((c) =>
      c.type === command.capability && c.state?.instance === command.instance
        ? { ...c, state: { instance: command.instance, value: command.value } }
        : c,
    );
    return this.ok(device, command.capability, command.instance);
  }

  override async shutdown(): Promise<void> {
    this.state.clear();
  }
}

function cloneDeep<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
