// Single source of truth для UI-метаданных capabilities (label/icon/единицы).
// Используется DeviceCard / CapabilityControl / SceneEditor / DeviceDetailView.

import type { Capability, CapabilityType, DeviceProperty } from '@smarthome/shared';
import { CAPABILITY, INSTANCE } from '@smarthome/shared';

export interface CapabilityMeta {
  /** Подпись для control'а в UI. */
  label: string;
  /** Inline SVG-иконка (currentColor stroke). */
  icon: string;
  /** Единица измерения для отображения (если range). */
  unitSuffix?: string;
}

const ICON = {
  power:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M12 4v8M7 7a7 7 0 1010 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  brightness:
    '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.7"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  thermometer:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M14 14V5a2 2 0 10-4 0v9a4 4 0 104 0z" stroke="currentColor" stroke-width="1.7"/></svg>',
  volume:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M5 9v6h3l5 4V5L8 9H5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M16 9a4 4 0 010 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  palette:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3a9 9 0 100 18c1 0 2-1 1-2-1-2 1-3 3-3h2a3 3 0 003-3c0-5-4-10-9-10z" stroke="currentColor" stroke-width="1.7"/></svg>',
  mode: '<svg viewBox="0 0 24 24" fill="none"><circle cx="6" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="18" cy="12" r="2" fill="currentColor"/></svg>',
  toggle:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="9" width="18" height="6" rx="3" stroke="currentColor" stroke-width="1.7"/><circle cx="16" cy="12" r="2" fill="currentColor"/></svg>',
  generic:
    '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/></svg>',
} as const;

const RANGE_META: Record<string, CapabilityMeta> = {
  [INSTANCE.BRIGHTNESS]: { label: 'Яркость', icon: ICON.brightness, unitSuffix: '%' },
  [INSTANCE.TEMPERATURE]: { label: 'Температура', icon: ICON.thermometer, unitSuffix: '°' },
  [INSTANCE.VOLUME]: { label: 'Громкость', icon: ICON.volume, unitSuffix: '%' },
  [INSTANCE.HUMIDITY]: { label: 'Влажность', icon: ICON.brightness, unitSuffix: '%' },
  [INSTANCE.CHANNEL]: { label: 'Канал', icon: ICON.mode },
  [INSTANCE.WORK_SPEED]: { label: 'Скорость', icon: ICON.mode, unitSuffix: '%' },
};

const MODE_META: Record<string, CapabilityMeta> = {
  [INSTANCE.THERMOSTAT]: { label: 'Режим термостата', icon: ICON.thermometer },
  [INSTANCE.FAN_SPEED]: { label: 'Скорость вентилятора', icon: ICON.mode },
  [INSTANCE.PROGRAM]: { label: 'Программа', icon: ICON.mode },
  [INSTANCE.CLEANUP_MODE]: { label: 'Режим уборки', icon: ICON.mode },
  [INSTANCE.COFFEE_MODE]: { label: 'Режим кофе', icon: ICON.mode },
  [INSTANCE.TEA_MODE]: { label: 'Режим чая', icon: ICON.mode },
};

const COLOR_INSTANCE_META: Record<string, CapabilityMeta> = {
  [INSTANCE.RGB]: { label: 'Цвет', icon: ICON.palette },
  [INSTANCE.HSV]: { label: 'Цвет', icon: ICON.palette },
  [INSTANCE.TEMPERATURE_K]: {
    label: 'Цветовая температура',
    icon: ICON.thermometer,
    unitSuffix: 'K',
  },
};

const FALLBACK: CapabilityMeta = { label: 'Параметр', icon: ICON.generic };

export function capabilityMeta(
  cap: Pick<Capability, 'type' | 'state' | 'parameters'>,
): CapabilityMeta {
  switch (cap.type) {
    case CAPABILITY.ON_OFF:
      return { label: 'Питание', icon: ICON.power };

    case CAPABILITY.RANGE: {
      const inst =
        cap.state?.instance ?? (cap.parameters as { instance?: string } | undefined)?.instance;
      return (inst ? RANGE_META[inst] : undefined) ?? { label: 'Уровень', icon: ICON.brightness };
    }

    case CAPABILITY.MODE: {
      const inst =
        cap.state?.instance ?? (cap.parameters as { instance?: string } | undefined)?.instance;
      return (inst ? MODE_META[inst] : undefined) ?? { label: 'Режим', icon: ICON.mode };
    }

    case CAPABILITY.COLOR_SETTING: {
      const inst = cap.state?.instance;
      return (
        (inst ? COLOR_INSTANCE_META[inst] : undefined) ?? { label: 'Цвет', icon: ICON.palette }
      );
    }

    case CAPABILITY.TOGGLE: {
      const inst =
        cap.state?.instance ?? (cap.parameters as { instance?: string } | undefined)?.instance;
      return { label: inst ? humanize(inst) : 'Переключатель', icon: ICON.toggle };
    }

    default:
      return FALLBACK;
  }
}

export function propertyMeta(prop: Pick<DeviceProperty, 'parameters'>): CapabilityMeta {
  const inst = prop.parameters.instance;
  return RANGE_META[inst] ?? { label: humanize(inst), icon: ICON.generic };
}

/** Стабильный ключ для v-for — capability'и не имеют id, нужен composite. */
export function capabilityKey(cap: Pick<Capability, 'type' | 'state' | 'parameters'>): string {
  const inst =
    cap.state?.instance ??
    (cap.parameters as { instance?: string } | undefined)?.instance ??
    'default';
  return `${cap.type}::${inst}`;
}

export function parseCapabilityKey(key: string): { type: CapabilityType; instance: string } {
  const sep = key.indexOf('::');
  return {
    type: key.slice(0, sep) as CapabilityType,
    instance: key.slice(sep + 2),
  };
}

const humanize = (s: string): string =>
  s.replace(/[_-]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
