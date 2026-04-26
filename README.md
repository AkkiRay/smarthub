# SmartHome Hub

Премиум-десктоп для управления Wi-Fi устройствами умного дома и **колонкой
Алисы** прямо с ПК. Полностью **offline-first**: один exe, без внешнего
backend-а, без Docker, без облаков. Премиум-UI в фирменной палитре Алисы
(`#6852FF → #A961FF → #FF61E6`), GSAP-анимации, продуманные user flow.

```
┌──────────────────────────────────────────────────────────────┐
│                    Vue 3 + GSAP renderer                      │
│       (premium dark UI, Pinia, vue-router, BEM SCSS)          │
└──────────────────────────────────────────────────────────────┘
                          ▲     ▲
                          │ IPC │ events
                          ▼     ▼
┌──────────────────────────────────────────────────────────────┐
│                    Electron main process                      │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              SmartHomeHub (центральный фасад)           │  │
│  │  devices · discovery · polling · scenes · drivers ·     │  │
│  │  rooms · yandexStation                                  │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ DriverRegistry│  │ DiscoveryService │  │ PollingService │  │
│  └──────────────┘  └──────────────────┘  └────────────────┘  │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ DeviceStore  │  │ SettingsStore    │  │ YandexStation- │  │
│  │ (SQLite WAL) │  │ (encrypted JSON) │  │ Client (WS)    │  │
│  └──────────────┘  └──────────────────┘  └────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                                              │
                                              │ wss://<ip>:1961
                                              ▼
                                  ┌──────────────────────────┐
                                  │  Колонка Алисы (LAN)     │
                                  │  Yandex Station / Mini   │
                                  └──────────────────────────┘
```

## Что умеет

- **27+ интеграций «из коробки»** — единый driver-registry, единая форма credentials.
  Локально (LAN, без облака): Yeelight, Shelly, WiZ, LIFX, Philips Hue, TP-Link
  Kasa/Tapo, Mi Home (miIO), WeMo, IKEA DIRIGERA. Универсальные протоколы:
  Matter / HomeKit (discovery), MQTT (Zigbee2MQTT/ESPHome/Tasmota), Generic HTTP.
  Cloud РФ/СНГ: **Сбер Дом**, **SaluteHome**, **Rubetek**. Cloud глобальные:
  Tuya/Smart Life, Mi Home Cloud, Aqara, eWeLink (Sonoff), Govee, SwitchBot,
  TP-Link Cloud, LIFX Cloud. Мосты: **Home Assistant**, **Z-Wave-JS**.
- **Управление с ПК** — on/off, яркость, цвет, температура, режимы, кастомные
  команды. Optimistic update в UI + state-polling раз в 30 секунд (configurable).
- **Сценарии** — composite-команды на N устройств с задержками, GUI-редактор.
  Сценарии можно отдавать колонке как голосовые «server-action».
- **Комнаты** — группировка устройств, иконка, drag-friendly UI.
- **Колонка Алисы** — прямое подключение через локальный JSONRPC (WSS :1961).
  TTS, голосовые команды, авто-reconnect с backoff, mDNS-discovery.
- **Production-grade hygiene** — single-instance lock, graceful shutdown,
  crash-handlers, polling с backoff на failed-устройства, encrypted storage.

## Quickstart

```bash
# Зависимости — Node 20+, pnpm 9+
pnpm install
pnpm rebuild         # native modules под текущий electron

# Все переменные окружения опциональны — у каждой есть дефолт в коде.
# Создайте `.env.development` в корне для override'ов (см. секцию «Конфигурация»).
pnpm dev
```

При первом запуске:

1. **Welcome** — приветственный flow (онбординг). После прохождения сохраняется
   в localStorage, повторно не показывается.
2. **Главная** — приветствие + быстрые сценарии. Кнопка «Найти устройства»
   открывает Discovery.
3. **Поиск** — нажмите «Начать поиск». Хаб опросит LAN всеми активными
   драйверами; найденные кандидаты появятся карточками. Mock-симулятор
   включён по умолчанию (`HUB_ENABLE_MOCK=true`) — UI можно тыкать без железа.
4. **Алиса** — раздел подключения колонки.

## Подключение колонки Алисы

В один клик: раздел «Алиса» → **«Войти через Яндекс»**. Открывается окно
oauth.yandex.ru, после авторизации хаб делает всё сам.

Что происходит под капотом:

1. **Implicit OAuth** через `oauth.yandex.ru/authorize?response_type=token&client_id=23cab…`
   — это публичный client_id Яндекс.Музыки, единственный, у которого есть scope
   на Glagol API. **Логин и пароль остаются в Яндексе**, хаб получает только
   `access_token` (живёт ~1 год).
2. **`GET /glagol/device_list`** на `quasar.yandex.net` с `Authorization: Oauth <token>` —
   возвращает список колонок аккаунта (id, name, platform).
3. **`GET /glagol/token?device_id=X&platform=Y`** с тем же заголовком — возвращает
   per-device **JWT (~1 час жизни)** для конкретной колонки.
4. **mDNS `_yandexio._tcp.local`** даёт `host:port` в локальной сети.
5. **WSS** на `wss://<host>:1961/?token=<jwt>` — обычный JSONRPC-канал.
6. **Авто-обновление JWT.** При 401 / `tokenExpiresAt - now < 60s` хаб сам
   запрашивает свежий JWT через шаги 3 и переподключается.

Дальше колонка получает `sendText` (TTS) и `voiceCommand` (как будто пользователь
сам произнёс), а сценарии хаба можно отдавать как `serverAction`.

Если OAuth недоступен (закрытая сеть, токен закончился), в UI остался
ручной fallback под `<details>`: scan LAN → ввести host/deviceId/token руками.

## Drivers

UI: **Настройки → Интеграции** — единый маркетплейс с группировкой по категории
и динамической формой credentials (рендерится из `descriptor.credentialsSchema`).

**Локальные LAN:** Yeelight · Shelly · WiZ · LIFX · Philips Hue · TP-Link
Kasa · TP-Link Tapo · Mi Home (miIO) · Belkin WeMo · IKEA DIRIGERA.

**Универсальные протоколы:** Matter (discovery) · HomeKit (discovery) · MQTT
(Zigbee2MQTT/ESPHome/Tasmota) · Generic HTTP.

**Cloud РФ/СНГ:** Сбер Дом · SaluteHome · Rubetek.

**Cloud глобальные:** Tuya/Smart Life · Mi Home Cloud · Aqara · eWeLink (Sonoff)
· Govee · SwitchBot · TP-Link Cloud · LIFX Cloud.

**Bridges:** Home Assistant (закрывает все интеграции HA одним токеном) · Z-Wave-JS.

Каждый драйвер живёт в [`apps/desktop/electron/core/drivers/<id>/`](apps/desktop/electron/core/drivers/) и
экспортирует `module.ts` с `descriptor + create()`. Регистрация нового драйвера —
одна строка в [`driver-registry.ts`](apps/desktop/electron/core/drivers/driver-registry.ts) `DRIVER_MODULES`.

## Конфигурация (.env)

Все переменные опциональны — у каждой есть sane default в коде. Для локальных
override'ов создайте `.env.development` в корне репозитория (он в `.gitignore`,
секреты не утекут). Vite подхватит файл автоматически при `pnpm dev`.

| Переменная                  | Значение                                          | Default |
| --------------------------- | ------------------------------------------------- | ------- |
| `LOG_LEVEL`                 | debug / info / warn / error                       | `info`  |
| `HUB_DISCOVERY_INTERVAL_MS` | интервал между active-discovery циклами           | `15000` |
| `HUB_DISCOVERY_TIMEOUT_MS`  | timeout одного scan-а драйвера                    | `4000`  |
| `HUB_POLL_INTERVAL_MS`      | как часто опрашивать online-устройства (0 = выкл) | `30000` |
| `HUB_ENABLE_MOCK`           | `true`/`false` — включить симулятор               | `false` |
| `HUB_OPEN_DEVTOOLS`         | открывать DevTools в dev-режиме                   | `false` |

> **Креденшалы драйверов** (Tuya / MQTT / Yandex и др.) в `.env` НЕ кладутся —
> они зашифрованно хранятся в `%APPDATA%/SmartHome Hub/` (Windows) /
> `~/Library/Application Support/SmartHome Hub/` (macOS) и настраиваются
> прямо в приложении: «Настройки → Интеграции», «Алиса».

## Production hygiene

- **Single-instance lock** — повторный запуск фокусирует уже открытое окно
  (без него SQLite WAL-файлы могут битться, multicast-сокеты подерутся).
- **Graceful shutdown** с 5-секундным таймаутом — closes drivers, polling,
  station, store.
- **Crash handlers** — `uncaughtException`, `unhandledRejection`,
  `render-process-gone` логируются + диалог пользователю при crash renderer-а.
- **Polling backoff** — `unreachable`-устройства опрашиваются в 4× реже,
  чтобы не флудить LAN отвалившимся железом.
- **Concurrency throttle** — discovery и polling параллелят с лимитом 6
  устройств одновременно.
- **CSP via headers** — main process инжектит политику; в production
  `connect-src 'self'`, в dev — расширенно для Vite HMR.
- **Permissions** — `setPermissionRequestHandler` отказывает renderer-у в
  любом permission-запросе (camera, mic, geolocation — приложение их не
  использует).

## Структура

```
SmartHome/
├── apps/desktop/
│   ├── electron/
│   │   ├── main/                    # bootstrap + IPC handlers + security
│   │   ├── preload/                 # contextBridge с типизированным API
│   │   └── core/
│   │       ├── hub/                 # SmartHomeHub фасад
│   │       ├── drivers/             # 6 drivers
│   │       ├── alice/               # Yandex Station local client + discovery
│   │       ├── discovery/polling/scenes/registry/storage/
│   ├── src/                         # Vue 3 renderer
│   │   ├── views/                   # 8 экранов (Welcome, Home, Devices,
│   │   │                            #            DeviceDetail, Discovery,
│   │   │                            #            Rooms, Scenes, Alice, Settings)
│   │   ├── components/              # chrome, devices, scenes, visuals
│   │   ├── stores/                  # 7 Pinia stores
│   │   ├── composables/             # useGsap, usePressable
│   │   └── styles/                  # BEM SCSS, design tokens, glass-morphism
│   ├── build/                       # icons + electron-builder ресурсы
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── packages/shared/                 # типы (Device/IPC/YandexStation/Scene/Driver)
└── README.md
```

## Сборка инсталлятора

```bash
pnpm package          # NSIS / DMG / AppImage в apps/desktop/release/<version>/
```

Перед production-сборкой:

1. Сконвертируйте `apps/desktop/build/icon.svg` → `icon.ico` / `icon.icns` /
   `icon.png` (см. `apps/desktop/build/README.md`).
2. Проверьте версию в `apps/desktop/package.json`.
3. Установите `CSC_LINK` / `CSC_KEY_PASSWORD` если нужна подпись Windows
   и `CSC_NAME` для Apple Developer ID.

## Безопасность

- IPC: `contextIsolation: true`, `nodeIntegration: false`, sandbox-friendly preload.
- CSP инжектится main-процессом — `connect-src 'self'` в production.
- Renderer ничего не ходит наружу самостоятельно — все network через main.
- Secrets (driver-credentials, glagol-token) хранятся в encrypted electron-store
  на уровне ОС (DPAPI на Windows, Keychain на macOS).
- WSS к колонке использует `rejectUnauthorized: false` — норма для self-signed
  cert на local-only устройстве (нет публичного домена / CA).
- `setWindowOpenHandler` + `will-navigate` блокируют любую навигацию вне
  bundle-а, внешние ссылки уходят в системный браузер.

## Troubleshooting

### Native modules не находятся в production-сборке

```bash
pnpm rebuild
```

`electron-builder install-app-deps` пересобирает better-sqlite3 под версию
electron-а, которая указана в devDependencies.

### Yeelight не находится в LAN

Убедитесь что в Yeelight-приложении включён режим **«LAN Control»** — без него
колба не отвечает на M-SEARCH.

### Колонка Алисы постоянно reconnect-ает

Проверьте, что glagol-token не истёк — Яндекс ротирует токены примерно раз
в год. Получите новый и нажмите «Подключиться» ещё раз.

### Логи

- Windows: `%APPDATA%\smarthome-hub\logs\main.log`
- macOS: `~/Library/Logs/smarthome-hub/main.log`
- Linux: `~/.config/smarthome-hub/logs/main.log`

## License

MIT.
