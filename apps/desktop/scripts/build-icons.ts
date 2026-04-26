// =============================================================================
// build-icons.ts — конвертирует build/icon.svg и build/tray.svg в платформенные
// форматы, нужные electron-builder + main-процессу:
//
//   build/icon.png     1024×1024  — Linux AppImage / DEB
//   build/icon.ico     16/32/48/64/128/256 multi — Windows NSIS + BrowserWindow
//   build/icon.icns    нет на Windows-CI (создаётся только если есть png2icons)
//   build/icons/       16, 32, 48, 64, 128, 256 PNG — для tray + dev fallback
//   build/tray.png     32×32 PNG  — Tray-иконка (Windows/Linux)
//   build/tray@2x.png  64×64 PNG  — Tray HiDPI / macOS retina
//
// Запускается через tsx (`pnpm icons` → `tsx scripts/build-icons.ts`).
// Безопасно к повторным запускам — перезаписывает файлы только если SVG-исходник
// новее или содержимое отличается по sha1.
// =============================================================================

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BUILD = join(ROOT, 'build');

interface ResvgConstructor {
  new (
    svg: Buffer | string,
    options?: { fitTo?: { mode: 'width'; value: number }; background?: string },
  ): ResvgInstance;
}
interface ResvgInstance {
  render(): { asPng(): Buffer };
}
type PngToIcoFn = (input: Buffer | Buffer[] | string | string[]) => Promise<Buffer>;
interface Png2IconsModule {
  createICNS: (input: Buffer, scaler: number, padding: number) => Buffer | null;
  BICUBIC: number;
}

interface Deps {
  Resvg: ResvgConstructor;
  pngToIco: PngToIcoFn;
  png2icons: Png2IconsModule | null;
}

// Лениво подгружаем зависимости — чтобы скрипт не падал если они ещё не
// установлены, а просто вежливо подсказал что делать.
async function loadDeps(): Promise<Deps> {
  try {
    const { Resvg } = (await import('@resvg/resvg-js')) as { Resvg: ResvgConstructor };
    const pngToIcoMod = (await import('png-to-ico')) as { default: PngToIcoFn };
    const pngToIco: PngToIcoFn = pngToIcoMod.default;
    let png2icons: Png2IconsModule | null = null;
    try {
      const mod = (await import('png2icons')) as { default: Png2IconsModule };
      png2icons = mod.default;
    } catch {
      /* optional — без него .icns не генерируется */
    }
    return { Resvg, pngToIco, png2icons };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[icons] Не хватает dev-deps. Установите:');
    // eslint-disable-next-line no-console
    console.error(
      '       pnpm add -D --filter @smarthome/desktop @resvg/resvg-js png-to-ico png2icons',
    );
    // eslint-disable-next-line no-console
    console.error(`       (${e instanceof Error ? e.message : String(e)})`);
    process.exit(1);
  }
}

// Render SVG → PNG buffer. Resvg делает CPU-rendering без headless-Chromium,
// быстрый (rust binding) и предсказуемый.
function svgToPng(Resvg: ResvgConstructor, svgBuf: Buffer, size: number): Buffer {
  const r = new Resvg(svgBuf, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0, 0, 0, 0)',
  });
  return r.render().asPng();
}

function shouldRebuild(srcPath: string, outPath: string): boolean {
  if (!existsSync(outPath)) return true;
  const src = statSync(srcPath).mtimeMs;
  const out = statSync(outPath).mtimeMs;
  return src > out;
}

function writeIfChanged(outPath: string, buf: Buffer): boolean {
  if (existsSync(outPath)) {
    const prev = readFileSync(outPath);
    const a = createHash('sha1').update(prev).digest('hex');
    const b = createHash('sha1').update(buf).digest('hex');
    if (a === b) return false;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  return true;
}

async function main(): Promise<void> {
  const { Resvg, pngToIco, png2icons } = await loadDeps();

  const iconSvg = join(BUILD, 'icon.svg');
  const traySvg = join(BUILD, 'tray.svg');

  if (!existsSync(iconSvg)) {
    // eslint-disable-next-line no-console
    console.error(`[icons] Не найден ${iconSvg}`);
    process.exit(1);
  }

  // ---- App icon ---------------------------------------------------------
  const iconSvgBuf = readFileSync(iconSvg);

  // PNG (1024 — мастер-размер для Linux + autoscaling).
  const iconPng1024 = svgToPng(Resvg, iconSvgBuf, 1024);
  const iconPngPath = join(BUILD, 'icon.png');
  if (writeIfChanged(iconPngPath, iconPng1024)) {
    // eslint-disable-next-line no-console
    console.log(`[icons] icon.png (1024×1024) → ${iconPngPath}`);
  }

  // PNG-набор. 16-256 идут в .ico (Windows multi-size). 512 нужен Linux'у —
  // electron-builder подбирает 512×512.png для AppImage/deb автоматически,
  // если он лежит в build/icons/.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256] as const;
  const linuxSizes = [16, 32, 48, 64, 128, 256, 512] as const;
  const sizes: number[] = Array.from(new Set<number>([...icoSizes, ...linuxSizes])).sort(
    (a, b) => a - b,
  );
  const pngs: Buffer[] = sizes.map((s) => svgToPng(Resvg, iconSvgBuf, s));
  const sizeIndex = new Map<number, number>(sizes.map((s, i) => [s, i]));

  // Каждую — отдельным файлом в build/icons/ (для dev BrowserWindow icon
  // на Linux + tray fallback).
  sizes.forEach((s, i) => {
    const p = join(BUILD, 'icons', `${s}x${s}.png`);
    const png = pngs[i];
    if (png && writeIfChanged(p, png)) {
      // eslint-disable-next-line no-console
      console.log(`[icons] ${s}×${s} → ${p}`);
    }
  });

  // .ico — мульти-размер (16/24/32/48/64/128/256 в одном файле). Windows NSIS,
  // BrowserWindow.icon для Win, electron-builder автоматически подхватит.
  // 512 в .ico не кладём — Win API его всё равно не покажет.
  if (shouldRebuild(iconSvg, join(BUILD, 'icon.ico'))) {
    const icoPngs: Buffer[] = icoSizes
      .map((s) => {
        const idx = sizeIndex.get(s);
        return idx !== undefined ? pngs[idx] : undefined;
      })
      .filter((p): p is Buffer => p !== undefined);
    const ico = await pngToIco(icoPngs);
    writeFileSync(join(BUILD, 'icon.ico'), ico);
    // eslint-disable-next-line no-console
    console.log(`[icons] icon.ico (multi-size) → ${join(BUILD, 'icon.ico')}`);
  }

  // .icns — macOS DMG. png2icons опционален; если не установлен — пропускаем.
  if (png2icons && shouldRebuild(iconSvg, join(BUILD, 'icon.icns'))) {
    const icns = png2icons.createICNS(iconPng1024, png2icons.BICUBIC, 0);
    if (icns) {
      writeFileSync(join(BUILD, 'icon.icns'), icns);
      // eslint-disable-next-line no-console
      console.log(`[icons] icon.icns → ${join(BUILD, 'icon.icns')}`);
    } else {
      // eslint-disable-next-line no-console
      console.warn('[icons] png2icons.createICNS вернул null — .icns пропущен');
    }
  }

  // ---- Tray icon --------------------------------------------------------
  if (existsSync(traySvg)) {
    const traySvgBuf = readFileSync(traySvg);
    const traySizes: ReadonlyArray<{ name: string; size: number }> = [
      { name: 'tray.png', size: 32 },
      { name: 'tray@2x.png', size: 64 },
      { name: 'tray@3x.png', size: 96 },
      { name: 'tray-16.png', size: 16 },
    ];
    for (const t of traySizes) {
      const buf = svgToPng(Resvg, traySvgBuf, t.size);
      const p = join(BUILD, t.name);
      if (writeIfChanged(p, buf)) {
        // eslint-disable-next-line no-console
        console.log(`[icons] ${t.name} (${t.size}×${t.size}) → ${p}`);
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('[icons] done.');
}

main().catch((e: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[icons] error:', e);
  process.exit(1);
});
