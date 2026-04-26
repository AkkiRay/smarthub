// Типизированные factory'и для конструирования Capability/Property.
// Используются и драйверами (mock, hue, ...) и mock-генератором сценариев в UI.

import type { Capability, DeviceProperty } from '../types/device.js';
import { CAPABILITY, INSTANCE, PROPERTY, RANGE, UNIT } from '../constants/capabilities.js';

export interface RangeSpec {
  min: number;
  max: number;
  precision?: number;
}

/** ON_OFF / on. */
export function capOnOff(value: boolean, retrievable = true): Capability {
  return {
    type: CAPABILITY.ON_OFF,
    retrievable,
    reportable: true,
    state: { instance: INSTANCE.ON, value },
  };
}

/** RANGE / brightness в процентах. */
export function capBrightness(percent: number, range: RangeSpec = RANGE.PERCENT): Capability {
  return {
    type: CAPABILITY.RANGE,
    retrievable: true,
    reportable: true,
    parameters: {
      instance: INSTANCE.BRIGHTNESS,
      unit: UNIT.PERCENT,
      range,
    },
    state: { instance: INSTANCE.BRIGHTNESS, value: clamp(percent, range.min, range.max) },
  };
}

/** RANGE / temperature в градусах Цельсия. */
export function capTemperatureRange(
  celsius: number,
  range: RangeSpec = RANGE.THERMOSTAT_C,
): Capability {
  return {
    type: CAPABILITY.RANGE,
    retrievable: true,
    reportable: true,
    parameters: {
      instance: INSTANCE.TEMPERATURE,
      unit: UNIT.TEMPERATURE_C,
      range,
    },
    state: { instance: INSTANCE.TEMPERATURE, value: clamp(celsius, range.min, range.max) },
  };
}

/** RANGE / volume. */
export function capVolume(percent: number, range: RangeSpec = RANGE.VOLUME_PERCENT): Capability {
  return {
    type: CAPABILITY.RANGE,
    retrievable: true,
    reportable: true,
    parameters: { instance: INSTANCE.VOLUME, unit: UNIT.PERCENT, range },
    state: { instance: INSTANCE.VOLUME, value: clamp(percent, range.min, range.max) },
  };
}

export interface ColorOptions {
  /** Поддерживается ли HEX/RGB. */
  rgb?: boolean;
  /** Если задано — устройство умеет CCT (Кельвины). */
  temperatureK?: RangeSpec;
}

/**
 * COLOR_SETTING. Один параметр объединяет RGB и CCT — это требование Yandex schema.
 * `state.instance` = 'rgb' если последнее значение цветовое; 'temperature_k' если CCT.
 */
export function capColor(state: ColorState, opts: ColorOptions): Capability {
  const parameters: Record<string, unknown> = {};
  if (opts.rgb !== false) parameters['color_model'] = 'rgb';
  if (opts.temperatureK) parameters['temperature_k'] = opts.temperatureK;

  return {
    type: CAPABILITY.COLOR_SETTING,
    retrievable: true,
    reportable: true,
    parameters,
    state:
      state.kind === 'rgb'
        ? { instance: INSTANCE.RGB, value: state.value & 0xffffff }
        : { instance: INSTANCE.TEMPERATURE_K, value: state.value },
  };
}

export type ColorState = { kind: 'rgb'; value: number } | { kind: 'temperature_k'; value: number };

/** MODE — список значений режима + текущее. */
export function capMode(instance: string, modes: readonly string[], current: string): Capability {
  return {
    type: CAPABILITY.MODE,
    retrievable: true,
    reportable: true,
    parameters: {
      instance,
      modes: modes.map((value) => ({ value })),
    },
    state: { instance, value: current },
  };
}

/** TOGGLE (boolean-mode: backlight, mute, ionization). */
export function capToggle(instance: string, value: boolean): Capability {
  return {
    type: CAPABILITY.TOGGLE,
    retrievable: true,
    reportable: true,
    parameters: { instance },
    state: { instance, value },
  };
}

// ---- Properties --------------------------------------------------------------

export function propFloat(instance: string, value: number, unit?: string): DeviceProperty {
  return {
    type: PROPERTY.FLOAT,
    retrievable: true,
    reportable: true,
    parameters: { instance, ...(unit ? { unit } : {}) },
    state: { instance, value },
  };
}

export function propEvent(instance: string, value: string): DeviceProperty {
  return {
    type: PROPERTY.EVENT,
    retrievable: true,
    reportable: true,
    parameters: { instance },
    state: { instance, value },
  };
}

// ---- helpers -----------------------------------------------------------------

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/**
 * Найти capability по типу + опционально по instance.
 *
 * Instance матчится в два этапа:
 *   1. `state.instance` — главный источник у Yandex (instance активного режима).
 *   2. `parameters.instance` — fallback для случая, когда state==null (например,
 *      лампа выключена и Yandex вернул capability с пустым state'ом).
 *
 * Без второго этапа `findCapability(caps, 'range', 'brightness')` возвращал
 * `undefined` для выключенной лампы — UI рисовал «нет brightness», хотя на
 * самом деле капабилити есть, просто нет current value.
 */
export function findCapability(
  list: readonly Capability[],
  type: Capability['type'],
  instance?: string,
): Capability | undefined {
  return list.find((c) => {
    if (c.type !== type) return false;
    if (instance === undefined) return true;
    if (c.state?.instance === instance) return true;
    const paramInstance = (c.parameters as { instance?: unknown } | undefined)?.instance;
    return paramInstance === instance;
  });
}

export function findProperty(
  list: readonly DeviceProperty[],
  instance: string,
): DeviceProperty | undefined {
  return list.find((p) => p.parameters.instance === instance);
}
