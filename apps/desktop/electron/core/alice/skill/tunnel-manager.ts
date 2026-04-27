/**
 * @fileoverview Cloudflared subprocess-manager — поднимает HTTPS-туннель к
 * локальному {@link WebhookServer}, чтобы Алиса могла достучаться до хаба
 * через публичный URL.
 *
 * Режимы работы:
 *   - **Quick-tunnel** (`cloudflared tunnel --url http://127.0.0.1:<port>`) —
 *     бесплатно без регистрации, выдаётся `*.trycloudflare.com` URL,
 *     меняется при каждом перезапуске.
 *   - **Named tunnel** (`cloudflared tunnel run <name>`) — стабильный URL на
 *     своём домене; требует cloudflared login + `customDomain` в config.
 *
 * URL парсится из `stderr` cloudflared (структурированных ID/URL stdout у него
 * нет). Парсинг делает regex по строке `Your tunnel URL is https://...`.
 *
 * Resilience:
 *   - При падении subprocess — exponential backoff (1s, 2s, 4s, 8s, max 60s).
 *   - URL change → broadcast event'а наверх (UI обновит endpoint в config'е).
 *
 * Почему cloudflared:
 *   - Бесплатно без регистрации (quick-tunnel).
 *   - Latency хорошо ложится в 3-секундный SLA Алисы.
 *   - Нативные binary под Win/Mac/Linux.
 *
 * Альтернативы (ngrok, frp, localtunnel) — юзер может выбрать через
 * `customDomain` или manual-mode, см. {@link AliceSkillConfig}.
 *
 * NOTE: бинарник cloudflared НЕ бандлится в installer — ~30 МБ × 3 платформы.
 * При отсутствии в PATH — UI показывает диалог «Скачать cloudflared» с
 * прямой ссылкой на release page.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main.js';
import type { AliceTunnelStatus } from '@smarthome/shared';

/**
 * Quick-tunnel URL детектор. Cloudflare обещал `*.trycloudflare.com`, но в
 * 2023 был short-lived переход на `loca.lt`. Включаем `cfargotunnel.com`
 * (named tunnels) как fallback на случай ребрендинга edge'а.
 */
const QUICK_URL_REGEX = /https:\/\/[a-z0-9-]+\.(?:trycloudflare\.com|cfargotunnel\.com)/i;
const RECONNECT_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000, 60_000];
/** Hard-cap на reconnect-loop. После N неудач — стоп, юзер ручаемо рестартует. */
const RECONNECT_MAX_ATTEMPTS = 12;

export interface TunnelManagerOptions {
  /** Локальный порт, который надо проксировать. */
  localPort: number;
  /** Если задано — `cloudflared tunnel run <customDomain>` (named tunnel). */
  customDomain?: string;
  /**
   * Путь к cloudflared. По умолчанию — поиск в PATH (`cloudflared` или `.exe`).
   * UI может позволить юзеру указать кастомный путь.
   */
  binaryPath?: string;
}

export class TunnelManager extends EventEmitter {
  private status: AliceTunnelStatus = {
    running: false,
    publicUrl: null,
    kind: null,
  };
  private child: ChildProcess | null = null;
  private retryCount = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private opts: TunnelManagerOptions | null = null;

  getStatus(): AliceTunnelStatus {
    return { ...this.status };
  }

  /**
   * Запустить tunnel. Резолвится после получения publicUrl ИЛИ через 15с (timeout).
   * При timeout статус остаётся running:false, lastError содержит причину.
   */
  async start(opts: TunnelManagerOptions): Promise<AliceTunnelStatus> {
    if (this.child) await this.stop();
    this.opts = opts;
    this.retryCount = 0;
    return this.spawnAndWait(opts);
  }

  async stop(): Promise<AliceTunnelStatus> {
    // opts → null до клиринга таймеров, иначе scheduleReconnect, который
    // уже пошёл setTimeout, может вернуться и spawn'ить новый cloudflared
    // после явного stop().
    this.opts = null;
    this.retryCount = 0;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const child = this.child;
    this.child = null;
    if (child) {
      child.kill('SIGTERM');
      // Дадим cloudflared 2с на graceful, иначе SIGKILL.
      await new Promise<void>((resolve) => {
        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          resolve();
        };
        child.once('exit', finish);
        setTimeout(() => {
          if (!resolved) {
            try {
              child.kill('SIGKILL');
            } catch {
              /* already exited */
            }
            finish();
          }
        }, 2_000);
      });
    }
    this.status = {
      ...this.status,
      running: false,
      publicUrl: null,
    };
    this.emit('status', this.status);
    return this.getStatus();
  }

  // ============== Internals ==============

  private async spawnAndWait(opts: TunnelManagerOptions): Promise<AliceTunnelStatus> {
    const binary = opts.binaryPath ?? defaultCloudflaredBinary();
    if (!isExecutableAccessible(binary)) {
      this.status = {
        running: false,
        publicUrl: null,
        kind: null,
        lastError: `cloudflared не найден (${binary}). Перезапустите туннель — хаб скачает бинарник автоматически.`,
      };
      this.emit('status', this.status);
      return this.getStatus();
    }

    const args = opts.customDomain
      ? ['tunnel', 'run', opts.customDomain]
      : ['tunnel', '--url', `http://127.0.0.1:${opts.localPort}`, '--no-autoupdate'];

    // Безопасное логирование — если в будущем добавится `--token <jwt>` или
    // `--credentials-file` (кастомные args от юзера), они не должны утечь в main.log.
    log.info(`[tunnel] spawning cloudflared ${redactArgs(args).join(' ')}`);

    return new Promise((resolve) => {
      const child = spawn(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.child = child;

      let resolved = false;
      const settle = () => {
        if (resolved) return;
        resolved = true;
        this.emit('status', this.status);
        resolve(this.getStatus());
      };

      // 15с на получение публичного URL — если не пришёл, считаем ошибку (но процесс не убиваем,
      // он продолжит ретраить — UI увидит обновление через event 'status').
      const initTimer = setTimeout(() => {
        if (!this.status.publicUrl) {
          this.status = {
            ...this.status,
            running: false,
            lastError: 'Не получили публичный URL за 15с. Проверьте интернет/cloudflared.',
          };
          settle();
        }
      }, 15_000);

      const handleLine = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed) return;
        log.debug(`[tunnel] ${trimmed}`);

        // Quick-tunnel: cloudflared печатает «Your quick Tunnel has been created!» + URL ниже
        // одной из последующих строк. Жёстко привязываемся к regex'у домена.
        if (!opts.customDomain) {
          const match = QUICK_URL_REGEX.exec(trimmed);
          if (match) {
            this.status = {
              running: true,
              publicUrl: match[0],
              kind: 'cloudflared-quick',
              lastUpAt: new Date().toISOString(),
            };
            clearTimeout(initTimer);
            settle();
          }
        } else {
          // Named-tunnel: считаем «running», когда увидим «Connection registered» / «Tunnel registered»
          if (/Tunnel registered|Connection .* registered/i.test(trimmed)) {
            this.status = {
              running: true,
              publicUrl: `https://${opts.customDomain}`,
              kind: 'cloudflared-named',
              lastUpAt: new Date().toISOString(),
            };
            clearTimeout(initTimer);
            settle();
          }
        }
      };

      // cloudflared пишет почти всё в stderr (как nginx/curl). Читаем оба stream'а.
      const lineBuffer = (stream: NodeJS.ReadableStream): void => {
        let buf = '';
        stream.on('data', (chunk: Buffer) => {
          buf += chunk.toString('utf8');
          let idx;
          while ((idx = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            handleLine(line);
          }
        });
      };
      if (child.stdout) lineBuffer(child.stdout);
      if (child.stderr) lineBuffer(child.stderr);

      child.on('exit', (code, signal) => {
        clearTimeout(initTimer);
        log.warn(`[tunnel] cloudflared exited code=${code} signal=${signal}`);
        const wasRunning = this.status.running;
        this.status = {
          ...this.status,
          running: false,
          publicUrl: null,
          lastError: wasRunning
            ? `cloudflared упал (code ${code ?? 'null'})`
            : `cloudflared не запустился (code ${code ?? 'null'})`,
        };
        this.child = null;
        this.emit('status', this.status);

        // Авто-перезапуск если опции ещё актуальны (юзер не звал stop).
        if (this.opts) this.scheduleReconnect();
        settle();
      });

      child.on('error', (err) => {
        log.error('[tunnel] spawn error', err);
        this.status = {
          running: false,
          publicUrl: null,
          kind: null,
          lastError: err.message,
        };
        clearTimeout(initTimer);
        settle();
      });
    });
  }

  private scheduleReconnect(): void {
    if (!this.opts) return;
    if (this.retryCount >= RECONNECT_MAX_ATTEMPTS) {
      log.warn(`[tunnel] reconnect cap reached (${RECONNECT_MAX_ATTEMPTS}) — stopping`);
      this.status = {
        ...this.status,
        running: false,
        publicUrl: null,
        lastError: `Туннель упал ${RECONNECT_MAX_ATTEMPTS} раз подряд. Перезапустите вручную.`,
      };
      this.emit('status', this.status);
      this.opts = null;
      return;
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(this.retryCount, RECONNECT_DELAYS_MS.length - 1)];
    this.retryCount += 1;
    log.info(
      `[tunnel] reconnect in ${delay}ms (attempt ${this.retryCount}/${RECONNECT_MAX_ATTEMPTS})`,
    );
    this.retryTimer = setTimeout(() => {
      if (this.opts) void this.spawnAndWait(this.opts);
    }, delay);
  }
}

function defaultCloudflaredBinary(): string {
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

/** Маскирует значения секретных флагов cloudflared перед логированием. */
const SECRET_FLAGS = new Set(['--token', '-t', '--credentials-file', '--cred-file']);
function redactArgs(args: string[]): string[] {
  const out = [...args];
  for (let i = 0; i < out.length - 1; i++) {
    if (SECRET_FLAGS.has(out[i]!)) out[i + 1] = '***';
  }
  return out;
}

function isExecutableAccessible(binary: string): boolean {
  // Если путь абсолютный — проверяем существование напрямую.
  if (path.isAbsolute(binary)) return existsSync(binary);
  // Иначе — оптимистично, OS сам разрулит через PATH; spawn выкинет ENOENT, который мы поймаем.
  return true;
}
