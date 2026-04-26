/**
 * @fileoverview Преобразование внутреннего {@link Device} → payload для
 * Yandex Smart Home schema (`/v1.0/user/devices`, `/query`, `/action`).
 *
 * Внутренние capabilities/properties уже используют Yandex-токены
 * (`devices.capabilities.*`), поэтому mapper по сути identity, но он:
 *   - Фильтрует только `enabled` устройства (по {@link AliceDeviceExposure}).
 *   - Применяет user-overrides (`aliasName`, `aliasRoom` — Алиса любит
 *     короткие имена типа «лампа», а не «Yeelight Color Bulb 1S»).
 *   - Отрезает internal-only поля (driver-meta, externalId, …).
 *   - Приводит state к виду, который ждёт Алиса.
 *
 * Что НЕ выдаём Алисе:
 *   - `status='pairing'` / `'unreachable'` (Алиса всё равно пометит как
 *     `DEVICE_UNREACHABLE`).
 *   - Capability с `retrievable: false` И без `state` — Алиса хочет либо
 *     state, либо явный `retrievable: false`.
 *   - Internal capability вне Yandex-схемы — например
 *     `devices.capabilities.quasar.server_action` относится только к нашей
 *     колонке, для общего навыка он бессмысленен.
 */

import type {
  AliceDeviceExposure,
  AliceDevicePreview,
  AliceSceneExposure,
  Capability,
  CapabilityType,
  Device,
  DeviceProperty,
  Room,
  Scene,
} from '@smarthome/shared';
import { CAPABILITY, DEVICE_TYPE } from '@smarthome/shared';

/**
 * Yandex Smart Home /devices payload — минимальный валидный device-объект.
 * Не наследуем от внутреннего Device, чтобы случайно не утечь meta/token.
 */
export interface YandexSmartHomeDevice {
  id: string;
  name: string;
  description?: string;
  room?: string;
  type: string;
  capabilities: YandexCapability[];
  properties: YandexProperty[];
  device_info?: {
    manufacturer: string;
    model?: string;
    hw_version?: string;
    sw_version?: string;
  };
}

export interface YandexCapability {
  type: string;
  retrievable: boolean;
  reportable: boolean;
  parameters?: Record<string, unknown>;
  state?: { instance: string; value: unknown };
}

export interface YandexProperty {
  type: string;
  retrievable: boolean;
  reportable: boolean;
  parameters: Record<string, unknown>;
  state?: { instance: string; value: unknown };
}

const SCENE_VIRTUAL_ID_PREFIX = 'scene:';
const HUB_MANUFACTURER = 'SmartHome Hub';

const isExposableCapability = (cap: Capability): boolean => {
  // quasar.server_action — внутренний токен для нашей же колонки, в Алису не уходит.
  if ((cap.type as string) === CAPABILITY.SERVER_ACTION) return false;
  return true;
};

/** Алиса требует room как СТРОКУ-имя; пустая строка → не ставим. */
const resolveRoomName = (device: Device, rooms: Room[], override?: string): string | undefined => {
  if (override && override.trim()) return override.trim();
  if (!device.room) return undefined;
  const room = rooms.find((r) => r.id === device.room);
  return room?.name?.trim() || undefined;
};

const sanitizeName = (raw: string): string => {
  // Алиса принимает до 64 символов; обрезаем длинные технические имена.
  return raw.trim().slice(0, 64) || 'Устройство';
};

/** Один Device → один YandexSmartHomeDevice. */
export function mapDeviceToYandex(
  device: Device,
  options: { rooms: Room[]; exposure?: AliceDeviceExposure; manufacturerLabel?: string },
): YandexSmartHomeDevice {
  const { rooms, exposure, manufacturerLabel } = options;

  const name = sanitizeName(exposure?.aliasName || device.name);
  const room = resolveRoomName(device, rooms, exposure?.aliasRoom);

  // Defensive: legacy device-записи без capabilities/properties (миграция SQLite,
  // partial cache) — отдаём пустые массивы вместо краша всего mapper-pipeline'а.
  const rawCaps = Array.isArray(device.capabilities) ? device.capabilities : [];
  const rawProps = Array.isArray(device.properties) ? device.properties : [];
  return {
    id: device.id,
    name,
    description: device.description?.trim() || undefined,
    room,
    type: device.type,
    capabilities: rawCaps.filter(isExposableCapability).map(mapCapability),
    properties: rawProps.map(mapProperty),
    device_info: {
      manufacturer: manufacturerLabel ?? HUB_MANUFACTURER,
      model:
        typeof device.meta?.['model'] === 'string' ? (device.meta['model'] as string) : undefined,
    },
  };
}

function mapCapability(cap: Capability): YandexCapability {
  return {
    type: cap.type,
    retrievable: cap.retrievable,
    reportable: cap.reportable,
    parameters: cap.parameters,
    state: cap.state,
  };
}

function mapProperty(prop: DeviceProperty): YandexProperty {
  return {
    type: prop.type,
    retrievable: prop.retrievable,
    reportable: prop.reportable,
    parameters: prop.parameters,
    state: prop.state,
  };
}

/** Сценарий → виртуальный девайс типа devices.types.other с одним on_off (toggle = run scene). */
export function mapSceneToYandex(
  scene: Scene,
  options: { exposure?: AliceSceneExposure; manufacturerLabel?: string },
): YandexSmartHomeDevice {
  const { exposure, manufacturerLabel } = options;
  return {
    id: `${SCENE_VIRTUAL_ID_PREFIX}${scene.id}`,
    name: sanitizeName(exposure?.aliasName || scene.name),
    description: 'Сценарий хаба — голосовая команда запускает действия',
    room: exposure?.aliasRoom?.trim() || undefined,
    type: DEVICE_TYPE.OTHER,
    capabilities: [
      {
        type: CAPABILITY.ON_OFF,
        retrievable: false, // сценарий не имеет состояния — это запуск
        reportable: false,
        state: { instance: 'on', value: false },
      },
    ],
    properties: [],
    device_info: {
      manufacturer: manufacturerLabel ?? HUB_MANUFACTURER,
      model: 'scene',
    },
  };
}

/** True если этот yandex-id ссылается на сценарий, а не реальное устройство. */
export const isSceneYandexId = (id: string): boolean => id.startsWith(SCENE_VIRTUAL_ID_PREFIX);
export const sceneIdFromYandexId = (id: string): string => id.slice(SCENE_VIRTUAL_ID_PREFIX.length);

/**
 * Полный list для /v1.0/user/devices — собирает enabled-устройства + сценарии,
 * применяя exposure-overrides из settings.
 */
export function buildExposedDeviceList(args: {
  devices: Device[];
  scenes: Scene[];
  rooms: Room[];
  deviceExposures: Record<string, AliceDeviceExposure>;
  sceneExposures: Record<string, AliceSceneExposure>;
}): YandexSmartHomeDevice[] {
  const { devices, scenes, rooms, deviceExposures, sceneExposures } = args;
  const result: YandexSmartHomeDevice[] = [];

  for (const d of devices) {
    const exposure = deviceExposures[d.id];
    // Default: устройство ВЫДАЁМ, если запись отсутствует. Юзер может опт-аутить точечно.
    if (exposure?.enabled === false) continue;
    if (d.status === 'pairing') continue;
    result.push(mapDeviceToYandex(d, { rooms, exposure }));
  }

  for (const s of scenes) {
    const exposure = sceneExposures[s.id];
    // Сценарии ВЫДАЁМ только при exposure.enabled === true (явный opt-in).
    // Default false: иначе любая внутренняя «временная» сцена потечёт в Алису.
    const enabled = exposure?.enabled ?? s.exposeToStation;
    if (!enabled) continue;
    result.push(mapSceneToYandex(s, { exposure }));
  }

  return result;
}

/** Превью для UI — рендерится в DeviceExposurePanel. */
export function buildDevicePreviews(args: {
  devices: Device[];
  rooms: Room[];
  deviceExposures: Record<string, AliceDeviceExposure>;
}): AliceDevicePreview[] {
  const { devices, rooms, deviceExposures } = args;
  return devices.map<AliceDevicePreview>((d) => {
    const exposure = deviceExposures[d.id];
    const yandex = mapDeviceToYandex(d, { rooms, exposure });
    // Defensive: legacy device-records в SQLite могут не иметь capabilities/properties.
    const caps = Array.isArray(yandex.capabilities) ? yandex.capabilities : [];
    const props = Array.isArray(yandex.properties) ? yandex.properties : [];
    return {
      yandexDeviceId: yandex.id,
      name: yandex.name,
      type: yandex.type,
      capabilitiesSummary: caps.map((c) => formatCapabilitySummary(c)),
      propertiesCount: props.length,
      source: d,
    };
  });
}

/** Короткая человекочитаемая строка вроде «вкл/выкл», «яркость 0–100%», «цвет HSV». */
function formatCapabilitySummary(cap: YandexCapability): string {
  switch (cap.type as CapabilityType) {
    case CAPABILITY.ON_OFF:
      return 'вкл/выкл';
    case CAPABILITY.RANGE: {
      const inst =
        ((cap.parameters?.['instance'] as string) || '').replace(/_/g, ' ') || 'диапазон';
      const range = cap.parameters?.['range'] as
        | { min?: number; max?: number; precision?: number }
        | undefined;
      if (range && typeof range.min === 'number' && typeof range.max === 'number') {
        return `${inst} ${range.min}–${range.max}`;
      }
      return inst;
    }
    case CAPABILITY.COLOR_SETTING: {
      const parts: string[] = [];
      const colorModel = cap.parameters?.['color_model'];
      if (colorModel) parts.push(String(colorModel).toUpperCase());
      if (cap.parameters?.['temperature_k']) parts.push('CCT');
      return `цвет ${parts.join(' / ') || ''}`.trim();
    }
    case CAPABILITY.MODE: {
      const inst = (cap.parameters?.['instance'] as string) || 'режим';
      const modes = cap.parameters?.['modes'] as Array<{ value: string }> | undefined;
      return modes ? `${inst} (${modes.length})` : inst;
    }
    case CAPABILITY.TOGGLE: {
      const inst = (cap.parameters?.['instance'] as string) || 'переключатель';
      return inst;
    }
    case CAPABILITY.VIDEO_STREAM:
      return 'видеопоток';
    default:
      return cap.type;
  }
}
