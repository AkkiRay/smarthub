# Contributing

Спасибо за интерес к SmartHome Hub. Этот документ описывает, как развернуть проект локально, какие есть процессы review и какие требования к коду.

## Локальная разработка

```bash
# Требуется Node.js >= 20.10 и pnpm >= 9.
pnpm install
pnpm dev          # запускает Vite + Electron в dev-режиме
```

Сборка десктоп-артефактов:

```bash
pnpm build:win        # NSIS installer + portable
pnpm build:mac        # DMG + ZIP (x64 + arm64)
pnpm build:linux      # AppImage + .deb
```

Проверки:

```bash
pnpm lint
pnpm typecheck
pnpm format:check
```

## Архитектурные правила

- **IPC-контракт.** Renderer не импортирует main process напрямую. Всё взаимодействие — через `window.smarthome.*` (см. `packages/shared/src/types/ipc.ts`). При добавлении канала правьте *одновременно* `IpcApi`, `preload/index.ts` и handler в `main/ipc/handlers.ts`.
- **Драйверы.** Новый интеграционный драйвер живёт в `apps/desktop/electron/core/drivers/<vendor>/`. Должен реализовывать общий `Driver` контракт и быть зарегистрирован в `driver-registry.ts`.
- **Безопасность по умолчанию.** `contextIsolation`, `sandbox`, CSP, deny-all permission handler. Не отключайте без явного обсуждения в issue.
- **Секреты.** Любые `password|token|secret|api[_-]?key|private[_-]?key|pin` НЕ должны пересекать IPC напрямую. См. `redactCredentials` в `main/ipc/handlers.ts`.

## Процесс PR

1. Откройте issue, если меняете публичное поведение или добавляете крупную фичу.
2. Бранч от `main`. Имя: `feat/...`, `fix/...`, `refactor/...`, `docs/...`.
3. Коммиты — Conventional Commits (`feat:`, `fix:`, `chore:` ...). Релизные ноты автогенерируются из них.
4. Откройте PR, заполните чек-лист в шаблоне.
5. CI должен проходить полностью (lint + typecheck + build на трёх ОС). Прервавшийся build блокирует merge.

## Релизы

Релиз делает мейнтейнер по тегу `vX.Y.Z`:

```bash
# Bump версии (root + apps/desktop), commit, tag, push.
pnpm version 1.2.3 --no-git-tag-version
# (правки package.json, потом)
git commit -am "chore: release v1.2.3"
git tag v1.2.3
git push origin main --tags
```

После пуша таги:
- `release.yml` запускает сборку на win/mac/linux.
- Артефакты загружаются в **draft**-релиз GitHub.
- После успешной сборки на всех платформах draft автоматически промоутится в **published** — клиенты с включённым auto-update получают уведомление в течение 6 часов (или мгновенно при ручной проверке).

Альтернативно: вручную через `Actions → Release → Run workflow` с указанием версии.

## Code style

- Prettier (`.prettierrc.json` в корне). `pnpm format` форматирует всё.
- Vue 3 SFC: `<script setup lang="ts">` + `<template>` + `<style lang="scss">`. BEM-классы.
- TypeScript strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Чините типы в месте, не глушите `as any`.
- Комментарии — bigtech-style: «что делает код», без «зачем добавили / для кого / fixes-bug-#». Комментарий нужен только когда смысл неочевиден из имени.

## Лицензия

MIT. PR засчитывается как разрешение использовать ваш код под этой лицензией.
