# Security policy

## Поддерживаемые версии

Поддерживается только последний минорный релиз. Старые версии не получают патчей.

| Версия    | Поддержка |
| --------- | --------- |
| latest    | ✅        |
| < latest  | ❌        |

## Сообщить об уязвимости

**Не открывайте публичный issue.** Используйте приватный канал GitHub:

👉 [github.com/AkkiRay/smarthub/security/advisories/new](https://github.com/AkkiRay/smarthub/security/advisories/new)

Что приложить:

1. Описание (1–3 предложения).
2. Версия SmartHome Hub и ОС.
3. Шаги воспроизведения, минимальный PoC.
4. Оценка impact'а: что именно компрометируется (creds в storage, RCE в renderer, IPC bypass и т. п.).

Целевое время ответа — 72 часа. После подтверждения мы обсудим окно раскрытия (обычно 30–90 дней) и опубликуем CVE через GitHub-advisory.

## Что входит в scope

- RCE в main или renderer process'е.
- IPC-обход sender-frame проверки или validation'а.
- Утечка `password / token / secret / api_key / private_key / pin` в renderer, в логи или в crash-reports.
- Bypass CSP / `contextIsolation` / `sandbox`.
- Угон сессии Yandex (oauth токены, glagol JWT).
- Подмена `latest.yml` в auto-update flow.

## Не входит в scope

- DoS через 100% CPU при массовом dispatch'е discovery (это резкий, но не security issue — тред в issue).
- Любая атака с физическим доступом или с правами админа на хосте.
- Issues, требующие изменения поставленной OS (например, AV отключён).
