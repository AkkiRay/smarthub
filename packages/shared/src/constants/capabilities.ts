/**
 * @fileoverview Канонические capability/property/instance/unit/range/timeout
 * токены — единая точка истины для драйверов и UI.
 *
 * Все строковые литералы совместимы со схемой Yandex Smart Home
 * (`devices.capabilities.*`, `devices.properties.*`, `devices.types.*`),
 * чтобы payload'ы можно было форвардить через Alice Smart Home Skill без
 * преобразований.
 *
 * @see {@link https://yandex.ru/dev/dialogs/smart-home/doc/concepts/}
 */

export const CAPABILITY = {
  ON_OFF: 'devices.capabilities.on_off',
  COLOR_SETTING: 'devices.capabilities.color_setting',
  RANGE: 'devices.capabilities.range',
  MODE: 'devices.capabilities.mode',
  TOGGLE: 'devices.capabilities.toggle',
  VIDEO_STREAM: 'devices.capabilities.video_stream',
  SERVER_ACTION: 'devices.capabilities.quasar.server_action',
  /**
   * Meta-capability Я.Станций. У одного устройства Yandex отдаёт несколько штук с
   * разными `instance` (`phrase_action`, `text_action`, `tts`, `voice_action`,
   * `sound_command`, …) — каждая принимает строковый action через тот же endpoint
   * `/m/user/devices/{id}/actions`.
   */
  QUASAR: 'devices.capabilities.quasar',
} as const;

export const PROPERTY = {
  FLOAT: 'devices.properties.float',
  EVENT: 'devices.properties.event',
} as const;

export const DEVICE_TYPE = {
  LIGHT: 'devices.types.light',
  SOCKET: 'devices.types.socket',
  SWITCH: 'devices.types.switch',
  SENSOR: 'devices.types.sensor',
  THERMOSTAT: 'devices.types.thermostat',
  MEDIA: 'devices.types.media_device',
  TV: 'devices.types.media_device.tv',
  TV_BOX: 'devices.types.media_device.tv_box',
  RECEIVER: 'devices.types.media_device.receiver',
  VACUUM: 'devices.types.vacuum_cleaner',
  HUMIDIFIER: 'devices.types.humidifier',
  DEHUMIDIFIER: 'devices.types.dehumidifier',
  PURIFIER: 'devices.types.purifier',
  KETTLE: 'devices.types.kettle',
  COOKING: 'devices.types.cooking',
  COFFEE_MAKER: 'devices.types.cooking.coffee_maker',
  COOKING_KETTLE: 'devices.types.cooking.kettle',
  MULTICOOKER: 'devices.types.cooking.multicooker',
  OPENABLE: 'devices.types.openable',
  CURTAIN: 'devices.types.openable.curtain',
  VALVE: 'devices.types.openable.valve',
  FAN: 'devices.types.fan',
  WASHING_MACHINE: 'devices.types.washing_machine',
  DISHWASHER: 'devices.types.dishwasher',
  IRON: 'devices.types.iron',
  CAMERA: 'devices.types.camera',
  LOCK: 'devices.types.lock',
  OTHER: 'devices.types.other',
} as const;

/** Канонические instance-имена (девайс может выставить любые, но эти — стандарт). */
export const INSTANCE = {
  ON: 'on',
  BRIGHTNESS: 'brightness',
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  CO2_LEVEL: 'co2_level',
  POWER: 'power',
  VOLUME: 'volume',
  CHANNEL: 'channel',
  RGB: 'rgb',
  HSV: 'hsv',
  TEMPERATURE_K: 'temperature_k',
  THERMOSTAT: 'thermostat',
  FAN_SPEED: 'fan_speed',
  PROGRAM: 'program',
  WORK_SPEED: 'work_speed',
  CLEANUP_MODE: 'cleanup_mode',
  COFFEE_MODE: 'coffee_mode',
  TEA_MODE: 'tea_mode',
  BATTERY_LEVEL: 'battery_level',
  WATER_LEVEL: 'water_level',
} as const;

export const UNIT = {
  PERCENT: 'unit.percent',
  TEMPERATURE_C: 'unit.temperature.celsius',
  TEMPERATURE_K: 'unit.temperature.kelvin',
  WATT: 'unit.watt',
  AMPERE: 'unit.ampere',
  VOLT: 'unit.volt',
  PPM: 'unit.ppm',
  LUX: 'unit.illumination.lux',
  KWH: 'unit.kilowatt_hour',
} as const;

/** Универсальные диапазоны (драйвер может уточнить per-device). */
export const RANGE = {
  PERCENT: { min: 1, max: 100, precision: 1 },
  PERCENT_FROM_ZERO: { min: 0, max: 100, precision: 1 },
  /** Безопасный диапазон CCT для бытовых ламп (Hue/LIFX/WiZ/Yeelight ≈ 2200-6500). */
  KELVIN_DEFAULT: { min: 2200, max: 6500 },
  /** Расширенный диапазон под LIFX/HomeKit. */
  KELVIN_WIDE: { min: 1500, max: 9000 },
  THERMOSTAT_C: { min: 5, max: 35, precision: 0.5 },
  VOLUME_PERCENT: { min: 0, max: 100, precision: 1 },
} as const;

/** Default-таймауты для драйверов. Перекрываются HUB_*_MS env-переменными. */
export const TIMEOUT = {
  /** Discovery cycle — общий abort всех драйверов. */
  DISCOVERY_CYCLE_MS: 4000,
  /** Один LAN-probe / RPC-вызов. */
  RPC_DEFAULT_MS: 2500,
  /** HTTP с retry. */
  HTTP_DEFAULT_MS: 4000,
  /** Periodic state-refresh interval. */
  POLL_DEFAULT_MS: 30_000,
  /** Минимальный allowed poll interval. */
  POLL_MIN_MS: 5_000,
  /** Continuous discovery — пауза между циклами. */
  DISCOVERY_INTERVAL_MS: 15_000,
} as const;
