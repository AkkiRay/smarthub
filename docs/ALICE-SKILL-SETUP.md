# Связка SmartHome Hub ↔ Алиса (Yandex Smart Home Skill)

> Гайд для разработчика и/или продвинутого юзера. Цель — получить полный контроль
> устройств хаба через Алису и приложение «Дом с Алисой» за **5 минут**.
> Документация Yandex проверена на 2026-04-27.

---

## TL;DR — что в итоге будет работать

1. Алиса в колонке/телефоне понимает «Алиса, включи лампу в гостиной» и хаб
   реально включает Yeelight / Hue / Shelly / любую из 30 поддерживаемых платформ.
2. В приложении «Дом с Алисой» появляются ВСЕ устройства хаба, включая те,
   которые Алиса напрямую не поддерживает.
3. Состояние обновляется мгновенно (через push-callback), а не через 30-секундный
   полл.

## Что вы делаете один раз вручную

Только **одно** — создаёте навык в `dialogs.yandex.ru/developer`. Хаб не может
сделать это за вас, потому что Yandex Dialogs не публикует API создания навыков.
Всё остальное — генерация кредов, поднятие туннеля, OAuth-pairing, реестрирование
устройств — хаб делает сам.

---

## Архитектура

```
   ┌──────────────────────────┐
   │  «Дом с Алисой» / колонка│
   └────────────┬─────────────┘
                │ HTTPS
                ▼
   ┌──────────────────────────┐
   │  dialogs.yandex.ru       │ ← вы регистрируете тут навык один раз
   │  (Yandex Smart Home)     │
   └────────────┬─────────────┘
                │ HTTPS (3-сек SLA)
                ▼
   ┌──────────────────────────┐
   │  *.trycloudflare.com     │ ← cloudflared quick-tunnel
   └────────────┬─────────────┘
                │ TCP localhost
                ▼
   ┌──────────────────────────┐
   │  SmartHome Hub           │
   │  127.0.0.1:<random-port> │ ← webhook + OAuth + state-pusher
   └────────────┬─────────────┘
                │ LAN/cloud
                ▼
   ┌──────────────────────────┐
   │  30 драйверов / 100+ устр│
   └──────────────────────────┘
```

### Endpoints, которые поднимает хаб

Все на `http://127.0.0.1:<random>`, наружу проксируется только cloudflared.

| Метод     | Путь                        | Назначение                                              |
| --------- | --------------------------- | ------------------------------------------------------- |
| `GET`     | `/oauth/authorize`          | HTML-форма «Привязать» с CSRF-nonce                     |
| `POST`    | `/oauth/authorize`          | Approve → выдача `code` + redirect на Я.                |
| `POST`    | `/oauth/token`              | Обмен `code` → access/refresh                           |
| `HEAD`    | `/v1.0`                     | Health-check Алисы                                      |
| `GET`     | `/v1.0/user/devices`        | Discovery — список устройств                            |
| `POST`    | `/v1.0/user/devices/query`  | Запрос текущего state                                   |
| `POST`    | `/v1.0/user/devices/action` | Команда (вкл/выкл/яркость/цвет/...)                     |
| `POST`    | `/v1.0/user/unlink`         | Юзер отвязал аккаунт                                    |

Все, кроме HEAD/authorize-GET, требуют валидный Bearer от хаба.

### Push в обратную сторону

Хаб дёргает `https://dialogs.yandex.net/api/v1/skills/<skill_id>/callback/{state|discovery}`
с заголовком `Authorization: OAuth <token>`. Токен живёт **на oauth.yandex.com под
client_id `c473ca268cd749d3a8371351a8f2bcbd`** — это публичный client_id Я.Диалогов
для callback API. Хаб открывает OAuth-окно сам, юзеру достаточно залогиниться **тем
же аккаунтом, что создал навык** (это критично — иначе callback вернёт 401).

---

## Шаги создания навыка (юзер делает в браузере)

### 1. Откройте `https://dialogs.yandex.ru/developer/skills`

Войдите тем же аккаунтом, который привяжет навык в «Доме с Алисой».

### 2. «Создать диалог» → тип «Умный дом»

Поля заполните как угодно:

| Поле         | Значение                                                 |
| ------------ | -------------------------------------------------------- |
| Название     | `My SmartHome Hub` (любое)                               |
| Категория    | `Бытовая техника`                                        |
| Описание     | `Мост от хаба SmartHome к Алисе`                         |
| Иконка       | любая 512×512                                            |

### 3. Раздел «Backend» → «Endpoint URL»

Сюда вставьте `<publicUrl>/v1.0` — публичный URL вы получите из хаба.

### 4. Раздел «Привязка аккаунтов» → выберите «OAuth»

Заполните 5 полей:

| Поле                          | Откуда взять                                  |
| ----------------------------- | --------------------------------------------- |
| URL авторизации               | `<publicUrl>/oauth/authorize`                 |
| URL получения токена          | `<publicUrl>/oauth/token`                     |
| URL обновления токена         | `<publicUrl>/oauth/token`                     |
| Идентификатор приложения      | `client_id` (хаб сгенерирует)                 |
| Секрет приложения             | `client_secret` (хаб сгенерирует)             |

> **В хабе уже есть кнопка** «Открыть консоль навыка с готовой конфигурацией» —
> она кладёт все 5 значений в clipboard за один клик. Не придётся переключаться
> между окнами 5 раз.

### 5. Сохраните навык. Скопируйте **Skill ID** (UUID из URL — `/skills/<uuid>/`).

Вставьте этот UUID в поле «Skill ID» в SmartHome Hub.

---

## Шаги в SmartHome Hub (всё автоматизировано)

### А. Откройте раздел «Алиса → Связка с Алисой»

### Б. В шаге 1 нажмите «Сгенерировать» возле OAuth client_id / client_secret

Хаб создаст криптографически случайные значения. Кликните по любой строчке —
скопирует в буфер.

### В. Нажмите «Получить через Яндекс ID» возле «Push-обновления»

Откроется встроенное OAuth-окно. **Войдите тем же аккаунтом**, что создал
навык. Хаб сразу дёрнет `login.yandex.ru/info` и покажет «Владелец токена · Имя
Логин» — если не тот аккаунт, повторите.

### Г. Нажмите «Сохранить креды»

### Д. Шаг 2 — «Запустить туннель» (одна кнопка делает всё)

Если `cloudflared` нет ни в PATH, ни в `userData/bin/` — кнопка покажет «Подключить
(скачать cloudflared)». Кликните: хаб скачает релиз с github.com/cloudflare/cloudflared,
проверит, поднимет туннель. Inline-прогресс прямо в карточке шага 2. Никаких
отдельных «Скачать» / «Проверить» / «Установить в PATH» — всё в одном клике.

После старта появится `*.trycloudflare.com` URL и **автоматически** запустится
проба достижимости (HEAD `<publicUrl>/v1.0` снаружи). Результат — зелёный
блок «HEAD /v1.0 → 200 · 184 мс» или красный с указанием HTTP-кода и причины.
Перепроверка каждые 90с пока туннель up — без ручных кликов.

### Ж. Шаг 3 — «Открыть страницу привязки в Дом с Алисой»

Кнопка ведёт прямо на `https://yandex.ru/quasar/skills/<skill_id>` — пропускает 4
клика по меню.

### З. Подтвердите привязку → готово

Hero-блок становится зелёным **только когда** хаб увидит реальный webhook от
Алисы (`/v1.0/user/devices` с валидным Bearer'ом). Stage `linked-stale` (жёлтый)
появится, если webhook'ов не было > 7 дней — это сигнал, что юзер отвязал в
приложении и надо переподключить.

---

## Что хаб делает за вас (автоматизация)

| Шаг                                            | Кто делает | Как                                                                |
| ---------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| Криптослучайные `client_id` / `client_secret`  | Хаб        | `crypto.randomBytes(32)`, base64url                                |
| OAuth-сервер (`/authorize`, `/token`, refresh) | Хаб        | `apps/desktop/electron/core/alice/skill/webhook-server.ts`         |
| Bearer-токены для Алисы (issue + verify)       | Хаб        | `token-issuer.ts`, sha256 на диске, constant-time compare          |
| **Скачивание cloudflared** (Win/Mac/Linux)     | Хаб        | `cloudflared-installer.ts` → GitHub release → `userData/bin/`      |
| **Распаковка `.tgz` на macOS**                 | Хаб        | системный `tar -xzf` + `chmod +x`                                  |
| Публичный HTTPS URL                            | Хаб        | `tunnel-manager.ts` поднимает `cloudflared tunnel --url ...`       |
| Внешняя проба достижимости (без кликов)        | Хаб        | `reachability-probe.ts` дёргает HEAD каждые 90с                    |
| Push state в Алису                             | Хаб        | `state-pusher.ts` debounce 1с → `dialogs.yandex.net/.../callback/state` |
| Discovery push (Алиса перечитает devices)      | Хаб        | при изменении exposure                                             |
| Защита от replay (request_id TTL 10 мин)       | Хаб        | `webhook-trust.ts`                                                 |
| CSRF-nonce на /authorize POST                  | Хаб        | `webhook-server.ts:issueAuthorizeNonce`                            |
| OAuth-окно для callback API                    | Хаб        | `yandex-oauth.ts` с client_id `c473ca268cd...`                     |
| Валидация владельца push-токена                | Хаб        | `verifyDialogsToken()` → `login.yandex.ru/info`                    |
| Auto-восстановление при падении cloudflared    | Хаб        | exponential backoff в `tunnel-manager.ts`                          |

---

## Как UI отражает реальное состояние (5 stage'й)

| Stage           | Цвет hero | Когда                                                   | Что делать юзеру                       |
| --------------- | --------- | ------------------------------------------------------- | -------------------------------------- |
| `idle`          | серый     | Креды не сохранены                                      | Заполнить шаг 1                        |
| `configured`    | violet    | Креды есть, туннеля нет                                 | Кликнуть «Запустить туннель»           |
| `tunnel-up`     | violet    | cloudflared жив, но reachability не подтверждена        | Кликнуть «Проверить»                   |
| `awaiting-link` | pink      | Reachability ✓, но webhook'ов от Алисы ещё не было      | Привязать в «Доме с Алисой»            |
| `linked`        | green     | Webhook от Алисы был ≤ 7 дней                           | Ничего, всё работает                   |
| `linked-stale`  | yellow    | Токен есть, но webhook'ов > 7 дней                      | Переподключить (вероятно отвязали)     |
| `error`         | red       | Cloudflared упал / config битый                         | Посмотреть `lastError`                 |

> **Ранее** UI «врал»: stage `linked` ставился сразу после первого OAuth, даже если
> юзер на следующий день отвязал в приложении. Теперь зелёный = Алиса реально
> работает прямо сейчас.

---

## Известные подводные камни

### «Token валиден, но push 401»

Юзер вошёл в OAuth-окно для callback-токена не тем аккаунтом, что создал навык.
В хабе теперь видно «Владелец токена · Иван Иванов / login=ivan» — сравните с
аккаунтом скилла. Решение: «Сменить токен» → войти правильным.

### «Туннель работает, Алиса всё равно говорит «не отвечает»»

Quick-tunnel cloudflared имеет cold-start: на edge'е DNS-запись появляется за
5-15 секунд после `Your tunnel URL is ...` в stderr. Хаб дёргает HEAD probe сразу
после старта + раз в 90с — если проба упала с 502/timeout, подождите 30с и
повторите.

### «После рестарта хаба Алиса теряет связь»

Quick-tunnel выдаёт **новый URL каждый запуск**. Решение: купите домен и поднимите
**named tunnel** (`cloudflared tunnel create` + `cloudflared tunnel run <name>`),
вставьте `customDomain` в шаге 1 — URL становится стабильным. Подробно — в
[docs.cloudflare.com/cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

### «Cloudflared нет в PATH»

Это больше не блокер: при первом «Запустить туннель» хаб **сам скачивает** нужный
бинарник в `app.getPath('userData')/bin/cloudflared(.exe)` и использует его. UI
показывает inline-прогресс «Скачиваю · 14% · 3.4 МБ из 24.1 МБ». Если у юзера
уже есть `cloudflared` в PATH (через `brew`/`winget`/ручную установку) — хаб
использует PATH-версию и ничего не качает (это позволяет апдейтам управляться
OS-package-managerом).

### «401 на /v1.0/user/devices»

Алиса использует Bearer, выданный хабом. После ручной чистки `issuedTokens` в
settings.json или после `/unlink` — повторите шаг 5 (привязку).

---

## Безопасность

- HUB_WEBHOOK_TRUST_TOKEN (env-var) — опциональный shared-secret. Cloudflared не
  пробрасывает его сам, нужно настроить **named tunnel + ingress headers**.
  Без него защита полагается на Bearer (это OK, но defense-in-depth полезнее).
- OAuth `/authorize` — single-user hub, без логина/пароля. CSRF защищён nonce'ом
  с TTL 10 мин (`AUTHORIZE_FORM_TTL_MS`).
- Bearer-токены хранятся как `sha256(token)` на диске. Lookup constant-time через
  `crypto.timingSafeEqual`.
- Redirect URI для `/oauth/authorize` ограничен allow-list:
  `social.yandex.net/.ru` + `dialogs.yandex.ru` (anti-open-redirect).
- Все ответы получают CSP / X-Frame-Options / COOP заголовки
  (`webhook-server.ts:applySecurityHeaders`).

---

## Где смотреть код

| Концерн                                          | Файл                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| Composition root                                 | `apps/desktop/electron/core/alice/skill/alice-bridge.ts`                  |
| HTTP server (webhook + OAuth)                    | `apps/desktop/electron/core/alice/skill/webhook-server.ts`                 |
| Туннель cloudflared                              | `apps/desktop/electron/core/alice/skill/tunnel-manager.ts`                 |
| Bearer-токены                                    | `apps/desktop/electron/core/alice/skill/token-issuer.ts`                   |
| Push state/discovery                             | `apps/desktop/electron/core/alice/skill/state-pusher.ts`                   |
| Reachability probe                               | `apps/desktop/electron/core/alice/skill/reachability-probe.ts`             |
| Авто-инсталлер cloudflared                       | `apps/desktop/electron/core/alice/skill/cloudflared-installer.ts`          |
| Доверие webhook (replay-protect)                 | `apps/desktop/electron/core/alice/skill/webhook-trust.ts`                  |
| OAuth-окна Yandex (music/dialogs)                | `apps/desktop/electron/core/alice/yandex-oauth.ts`                         |
| Маппер Device → Yandex device                    | `apps/desktop/electron/core/alice/skill/device-mapper.ts`                  |
| UI мастер                                        | `apps/desktop/src/components/alice/AliceSkillBridge.vue`                   |
| Pinia-стор                                       | `apps/desktop/src/stores/alice.ts`                                         |
| IPC-контракт                                     | `packages/shared/src/types/ipc.ts`                                         |
| Типы Alice                                       | `packages/shared/src/types/alice.ts`                                       |
