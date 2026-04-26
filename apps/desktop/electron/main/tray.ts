// SystemTray: делает Hub резидентным даже при закрытом окне.
// Иконку tray.png НЕ используем как template-image — glyph цветной (accent-точка).

import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import log from 'electron-log/main.js';

export interface TrayController {
  destroy(): void;
  refresh(): void;
}

interface TrayOptions {
  /** null если окно не создано / закрыто. */
  getMainWindow: () => BrowserWindow | null;
  /** Открывает или создаёт окно. */
  showMainWindow: () => Promise<void> | void;
  /** Запустить discovery и поднять окно на /discovery. */
  triggerDiscovery: () => Promise<void> | void;
}

// В prod лежит в asar.unpacked (см. asarUnpack в package.json), в dev — в apps/desktop/build/.
function resolveTrayIcon(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'app.asar.unpacked', 'build', 'tray.png'),
    join(app.getAppPath(), 'build', 'tray.png'),
    join(__dirname, '..', '..', 'build', 'tray.png'),
    join(__dirname, '..', '..', 'build', 'icons', '32x32.png'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

export function createTray(opts: TrayOptions): TrayController {
  const iconPath = resolveTrayIcon();
  if (!iconPath) {
    log.warn(
      'Tray: иконка не найдена в build/. Сгенерируйте через `pnpm --filter @smarthome/desktop icons`.',
    );
    return {
      destroy() {
        /* no-op */
      },
      refresh() {
        /* no-op */
      },
    };
  }

  const image = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin') {
    // Цветной glyph — НЕ template-image, иначе macOS перекрасит в monochrome.
    image.setTemplateImage(false);
  }

  const tray = new Tray(image);
  tray.setToolTip('SmartHome Hub');

  function rebuildMenu(): void {
    const win = opts.getMainWindow();
    const isVisible = !!win && win.isVisible() && !win.isMinimized();

    const menu = Menu.buildFromTemplate([
      {
        label: 'SmartHome Hub',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: isVisible ? 'Скрыть в трей' : 'Открыть',
        click: async () => {
          const w = opts.getMainWindow();
          if (isVisible && w) {
            w.hide();
          } else {
            await opts.showMainWindow();
          }
        },
      },
      {
        label: 'Найти устройства',
        click: async () => {
          await opts.showMainWindow();
          await opts.triggerDiscovery();
        },
      },
      { type: 'separator' },
      {
        label: 'Открыть логи',
        click: () => {
          const logFile = log.transports.file.getFile().path;
          void shell.showItemInFolder(logFile);
        },
      },
      { type: 'separator' },
      {
        label: 'Выйти',
        click: () => {
          // graceful shutdown через before-quit hook.
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(menu);
  }

  // Click → toggle окна (Windows/Linux convention).
  tray.on('click', () => {
    const w = opts.getMainWindow();
    if (w && w.isVisible() && !w.isMinimized()) {
      w.hide();
    } else {
      void opts.showMainWindow();
    }
  });

  // На Linux right-click нужен явно — Windows/macOS делают это через setContextMenu сами.
  tray.on('right-click', () => {
    rebuildMenu();
    tray.popUpContextMenu();
  });

  rebuildMenu();
  log.info(`Tray ready (icon=${iconPath})`);

  return {
    destroy: () => {
      tray.destroy();
    },
    refresh: () => {
      rebuildMenu();
    },
  };
}
