# Brand logos для интеграций

Эта папка — registry brand-SVG, которые подхватывает компонент
`@/components/visuals/BrandMark.vue` через `import.meta.glob` (eager,
raw — все SVG попадают в стартовый chunk без runtime-fetch).

## Покрытие — 31/31 driver

Все интеграции из `packages/shared/src/types/device.ts → KNOWN_DRIVER_IDS`
имеют brand-mark. Если для нового driver-id SVG отсутствует — `BrandMark.vue`
показывает fallback-circle с восклицательным знаком (видно сразу).

| Источник | Бренды |
| :--- | :--- |
| `simple-icons` (CC0) | shelly, hue, lifx, lifx-cloud, tplink-kasa, tplink-tapo, tplink-cloud, miio, mihome-cloud, dirigera (IKEA), wemo, yandex-iot, yandex-lamp, yandex-station, mqtt, homekit (Apple), home-assistant |
| Кастомные monochrome marks (24×24, `currentColor`) | yeelight, wiz, tuya, matter, govee, switchbot, aqara-cloud, ewelink, sber-home, salute-home, rubetek, zwavejs, generic-http, mock |

## Как добавить новый driver-id

1. Скачать или нарисовать монохромный SVG в 24×24 viewBox.
2. Заменить все `fill="#XXXXXX"` на `currentColor` — `BrandMark.vue` подменит
   цвет на accent из `driverPalette` runtime'е.
3. Сохранить под именем `<driver-id>.svg`. ID — точно как в
   `packages/shared/src/types/driver.ts → KNOWN_DRIVER_IDS`.
4. Перезапуск dev — Vite подхватит автоматически.

## Стиль

- Один `<path d="…">` (или несколько — но без stroke, только fill).
- Никаких inline `style`/`class` атрибутов.
- viewBox строго `0 0 24 24` — `BrandMark` ожидает этот размер.
