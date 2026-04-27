# Releasing SmartHome Hub

Этот документ — для мейнтейнера. Здесь — как нарезать релиз, как работают auto-updates, и какие GitHub-секреты нужны.

## TL;DR

```bash
# 1. Поднять версию в package.json + apps/desktop/package.json
# 2. git commit -am "chore: release v1.2.3"
# 3. git tag v1.2.3
# 4. git push origin main --tags
```

GitHub Actions автоматически:

1. Прогонит `pnpm format:check` + `pnpm typecheck`.
2. Соберёт win/mac/linux артефакты на трёх раннерах.
3. Опубликует draft-релиз.
4. Снимет draft-флаг → релиз появится в GH Releases как `latest`.
5. `electron-updater` в установленных клиентах подтянет `latest.yml` и предложит обновление.

## Архитектура auto-update

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│ User Hub (v1.0) │ ◄──────►│ GH Releases feed │◄────────│   release.yml   │
└────────┬────────┘ poll    └────────┬─────────┘ publish └─────────────────┘
         │ 6h interval               │
         │                           │
         ▼                           ▼
   electron-updater                latest.yml + .nupkg
   apps/desktop/                  latest-mac.yml + .dmg/.zip
   electron/main/                 latest-linux.yml + .AppImage
   auto-updater.ts
```

- **Feed:** `provider: 'github'` — `electron-updater` тянет `https://github.com/<owner>/<repo>/releases/latest/download/latest.yml`.
- **Публикация:** `electron-builder --publish always` (`pnpm release:*`) загружает .exe/.dmg/.AppImage + sha512-маркеры.
- **Проверка:** клиент стартует → через 60с делает первый check; далее каждые 6 часов. UI на любом этапе может вызвать `updater.check()`.

## GitHub Secrets

Для подписания и notarization (опционально — без них релиз пройдёт unsigned):

| Secret                        | Зачем                                                        |
| ----------------------------- | ------------------------------------------------------------ |
| `WIN_CSC_LINK`                | base64-кодированный .pfx-сертификат для Windows code-signing |
| `WIN_CSC_KEY_PASSWORD`        | Пароль от .pfx                                               |
| `MAC_CSC_LINK`                | base64-кодированный .p12 для macOS подписи                   |
| `MAC_CSC_KEY_PASSWORD`        | Пароль от .p12                                               |
| `APPLE_ID`                    | Apple ID для notarization                                    |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password для Apple ID                           |
| `APPLE_TEAM_ID`               | Team ID из Apple Developer                                   |

`GITHUB_TOKEN` создаётся автоматически — настраивать ничего не нужно.

## Ручной запуск через workflow_dispatch

```
GitHub → Actions → Release → Run workflow → version: 1.2.3
```

Workflow сам создаст коммит с bump'ом + тег и запустит сборку. Полезно для повторного выпуска артефактов или релиза «между коммитами», без локального git push.

## Ротация / откат

- **Откатить релиз:** в GH Releases пометить «Set as pre-release» или удалить — `electron-updater` его проигнорирует, новые клиенты не подтянут.
- **Hotfix:** нарезать новый тег `v1.2.4`, прокинуть как обычный релиз. `electron-updater` сравнит по semver и предложит обновление с любой более старой версии.

## Что попадает в релиз

| Платформа | Артефакт                                    | auto-update |
| --------- | ------------------------------------------- | ----------- |
| Windows   | `SmartHome Hub-X.Y.Z-setup.exe` (NSIS)      | ✅          |
| Windows   | `SmartHome Hub-X.Y.Z-portable.exe`          | ❌          |
| macOS     | `SmartHome Hub-X.Y.Z-x64.dmg` / `arm64.dmg` | ✅          |
| macOS     | `SmartHome Hub-X.Y.Z-x64.zip` / `arm64.zip` | ✅          |
| Linux     | `SmartHome Hub-X.Y.Z-x64.AppImage`          | ✅          |
| Linux     | `SmartHome Hub-X.Y.Z-amd64.deb`             | ❌ (apt)    |

Portable-build и .deb не поддерживают auto-update by design — пользователь обновляет их вручную.

## Troubleshooting

**Релиз не появился в auto-update fly.** Проверьте:

- `latest.yml` присутствует в release assets рядом с .exe/.dmg/.AppImage.
- Релиз НЕ помечен как `pre-release` или `draft`.
- Версия в `apps/desktop/package.json` совпадает с тегом (без префикса `v`).

**Сборка падает на macOS notarization.** Если у вас нет Apple Developer Program — удалите шаг подписи macOS. App запустится через `Right-click → Open` (Gatekeeper warning). Без notarization auto-update тоже работает, но первый запуск требует ручного подтверждения.

**`pnpm release:*` локально:** не нужен в обычном flow — релизы идут только через CI. Локально используйте `pnpm build:*` (без публикации).
