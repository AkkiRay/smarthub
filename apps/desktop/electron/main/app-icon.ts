// Single source of truth для иконки окна. Все BrowserWindow (main, OAuth,
// модалки) проходят через resolveAppIcon — иначе Electron подставит свой logo.

import { app, nativeImage, type NativeImage } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import log from 'electron-log/main.js';

let cachedIcon: NativeImage | null | undefined;
let cachedPath: string | null = null;

/** Кандидаты по приоритету: dev (build/) → prod asar.unpacked. */
function iconCandidates(): string[] {
  const onWin = process.platform === 'win32';
  return [
    onWin ? join(app.getAppPath(), 'build', 'icon.ico') : null,
    join(app.getAppPath(), 'build', 'icon.png'),
    join(app.getAppPath(), 'build', 'icons', '256x256.png'),
    onWin ? join(process.resourcesPath ?? '', 'app.asar.unpacked', 'build', 'icon.ico') : null,
    join(process.resourcesPath ?? '', 'app.asar.unpacked', 'build', 'icon.png'),
  ].filter((p): p is string => !!p);
}

export function resolveAppIcon(): NativeImage | undefined {
  if (cachedIcon !== undefined) return cachedIcon ?? undefined;

  for (const p of iconCandidates()) {
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) {
        cachedIcon = img;
        cachedPath = p;
        return img;
      }
    }
  }

  log.warn('App icon не найден в build/. Сгенерируйте через `pnpm icons`.');
  cachedIcon = null;
  return undefined;
}

/** Путь до файла иконки (для нужд `BrowserWindow({ icon: path })`-формы). */
export function resolveAppIconPath(): string | undefined {
  if (cachedIcon === undefined) resolveAppIcon();
  return cachedPath ?? undefined;
}
