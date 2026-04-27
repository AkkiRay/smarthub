/**
 * @fileoverview Авто-инсталлер `cloudflared`: качает релиз в `userData/bin/`,
 * проверяет версию, использует.
 *
 * Source: github.com/cloudflare/cloudflared/releases/latest/download/<asset>.
 *
 * Платформы:
 *   - Windows: `cloudflared-windows-{amd64|386}.exe`        — скачиваем напрямую.
 *   - Linux:   `cloudflared-linux-{amd64|arm64}`            — скачиваем + chmod +x.
 *   - macOS:   `cloudflared-darwin-{amd64|arm64}.tgz`       — скачиваем .tgz +
 *              распаковываем через системный `tar` + chmod +x.
 *
 * Не подменяем PATH-версию: если юзер уже поставил cloudflared (например, через
 * `brew` или `winget`) — берём его, чтобы апдейты управлялись OS-package-managerом.
 */

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { chmod, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import axios from 'axios';
import log from 'electron-log/main.js';
import type { AliceCloudflaredInstall } from '@smarthome/shared';

const RELEASE_DOWNLOAD_BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download';

/** Имя ассета в GitHub release под текущую платформу. */
function assetName(): string {
  const arch = process.arch;
  switch (process.platform) {
    case 'win32':
      // Windows — всегда .exe, ARM64 не публикуется → всё равно amd64 (через WoW64).
      return arch === 'ia32' ? 'cloudflared-windows-386.exe' : 'cloudflared-windows-amd64.exe';
    case 'linux':
      if (arch === 'arm64') return 'cloudflared-linux-arm64';
      if (arch === 'arm') return 'cloudflared-linux-arm';
      return 'cloudflared-linux-amd64';
    case 'darwin':
      return arch === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz';
    default:
      return 'cloudflared-linux-amd64';
  }
}

/** Конечное имя бинарника в `userData/bin/`. */
function binaryFileName(): string {
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

/** Где хаб хранит управляемый бинарник. */
export function managedBinaryPath(): string {
  return path.join(app.getPath('userData'), 'bin', binaryFileName());
}

export interface InstallProgress {
  /** 0..1; null если total не известен (ranged-download без Content-Length). */
  ratio: number | null;
  /** Скачанные байты. */
  bytesDone: number;
  /** Размер релиза, если известен. */
  bytesTotal: number | null;
  /** ms с начала загрузки. */
  elapsedMs: number;
}

export interface CloudflaredInstallerOptions {
  /** Колбэк для UI прогресса. Триггерится не чаще 8 раз в секунду. */
  onProgress?: (p: InstallProgress) => void;
}

export class CloudflaredInstaller {
  private downloading: Promise<string> | null = null;

  /** Текущий статус — UI показывает «installed / missing / downloading». */
  getStatus(): AliceCloudflaredInstall {
    const managed = managedBinaryPath();
    if (existsSync(managed)) {
      let sizeKb: number | undefined;
      try {
        sizeKb = Math.round(statSync(managed).size / 1024);
      } catch {
        /* noop */
      }
      return { kind: 'managed', path: managed, ...(sizeKb !== undefined ? { sizeKb } : {}) };
    }
    return { kind: 'missing' };
  }

  /**
   * Если бинарник уже установлен — отдаём путь сразу.
   * Иначе — скачиваем (с дедупликацией параллельных вызовов).
   */
  async ensureInstalled(opts: CloudflaredInstallerOptions = {}): Promise<string> {
    const managed = managedBinaryPath();
    if (existsSync(managed)) return managed;
    if (this.downloading) return this.downloading;
    this.downloading = this.download(opts).finally(() => {
      this.downloading = null;
    });
    return this.downloading;
  }

  /** Удалить кэшированный бинарник (юзер хочет «переустановить»). */
  async clear(): Promise<void> {
    const managed = managedBinaryPath();
    try {
      await rm(managed, { force: true });
    } catch (e) {
      log.warn('[cloudflared-installer] clear failed', e);
    }
  }

  // ============== Internals ==============

  private async download(opts: CloudflaredInstallerOptions): Promise<string> {
    const asset = assetName();
    const url = `${RELEASE_DOWNLOAD_BASE}/${asset}`;
    const targetDir = path.dirname(managedBinaryPath());
    mkdirSync(targetDir, { recursive: true });

    // .part-файл — при любом крэше очищаем (try/catch ниже), иначе lingering
    // partials съедают диск и на retry-е первый шаг упадёт с ENOSPC.
    const partPath = path.join(targetDir, `${binaryFileName()}.part`);
    const finalPath = managedBinaryPath();
    const cleanupPart = async (): Promise<void> => {
      try {
        await rm(partPath, { force: true });
      } catch {
        /* swallow — best-effort */
      }
    };

    log.info(`[cloudflared-installer] downloading ${asset} from ${url}`);
    const startedAt = Date.now();

    try {
      const response = await axios.get<NodeJS.ReadableStream>(url, {
        responseType: 'stream',
        timeout: 0,
        maxRedirects: 5,
        headers: { 'User-Agent': 'SmartHome-Hub/cloudflared-installer' },
      });

      const total = parseInt(String(response.headers['content-length'] ?? ''), 10);
      const bytesTotal = Number.isFinite(total) && total > 0 ? total : null;
      let bytesDone = 0;
      let lastReport = 0;

      await new Promise<void>((resolve, reject) => {
        const fileStream = createWriteStream(partPath);
        response.data.on('data', (chunk: Buffer) => {
          bytesDone += chunk.length;
          const now = Date.now();
          if (opts.onProgress && now - lastReport >= 125) {
            lastReport = now;
            opts.onProgress({
              ratio: bytesTotal ? bytesDone / bytesTotal : null,
              bytesDone,
              bytesTotal,
              elapsedMs: now - startedAt,
            });
          }
        });
        response.data.on('error', reject);
        fileStream.on('error', reject);
        fileStream.on('finish', () => resolve());
        response.data.pipe(fileStream);
      });

      // Финальный 100%-tick — без него UI остаётся на 99%.
      opts.onProgress?.({
        ratio: 1,
        bytesDone,
        bytesTotal: bytesTotal ?? bytesDone,
        elapsedMs: Date.now() - startedAt,
      });

      if (asset.endsWith('.tgz')) {
        // macOS: распаковываем через системный tar (есть на каждой macOS).
        // Внутри архива один файл `cloudflared`.
        await this.extractTgz(partPath, targetDir);
        await cleanupPart();
      } else {
        await rename(partPath, finalPath);
      }

      if (process.platform !== 'win32') {
        // 0o755 — owner: rwx, group/other: r-x. Стандартный mode для /usr/local/bin.
        await chmod(finalPath, 0o755);
      }

      log.info(
        `[cloudflared-installer] installed → ${finalPath} (${bytesDone} bytes in ${Date.now() - startedAt}ms)`,
      );
      return finalPath;
    } catch (err) {
      // Любая ошибка по пути → чистим .part, чтобы retry начался с нуля и не оставлял мусор.
      await cleanupPart();
      throw err;
    }
  }

  private async extractTgz(tgzPath: string, targetDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('tar', ['-xzf', tgzPath, '-C', targetDir], {
        stdio: 'ignore',
      });
      // ENOENT при отсутствии tar в PATH (теоретический edge на чистой macOS) —
      // ловим явно с понятной ошибкой, иначе UI покажет «Error: spawn tar ENOENT».
      child.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') {
          reject(
            new Error(
              'Системная утилита `tar` не найдена. Установите Xcode CLT: xcode-select --install',
            ),
          );
        } else reject(e);
      });
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tar exited with code ${code}`));
      });
    });
  }
}
