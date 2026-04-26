/**
 * @fileoverview Абстрактный базовый класс, от которого наследуются все драйверы.
 *
 * Что даёт:
 *   - Type-safe shape contract'а {@link DeviceDriver}, проверяемый компилятором
 *     (driver не зарегистрируется если хоть один abstract-метод не реализован).
 *   - Helper'ы для конструирования {@link DeviceCommandResult} envelope'ов:
 *     {@link BaseDriver.ok}, {@link BaseDriver.err}.
 *   - Logger с префиксом из driver id для удобного grep'а по main.log.
 *
 * Driver lifecycle:
 *   1. `discover(signal)`     — найти кандидатов на network / в cloud.
 *   2. `probe(candidate)`     — валидировать одного кандидата, вернуть Device.
 *   3. `readState(device)`    — обновить capabilities/properties (вызывается
 *                                polling-сервисом).
 *   4. `execute(device, cmd)` — применить команду (toggle, set color, …).
 *   5. `shutdown()`           — освободить resources при выходе из приложения.
 *
 * @example
 * ```ts
 * export class MyDriver extends BaseDriver {
 *   readonly id = 'my-driver' as const;
 *   readonly displayName = 'My Driver';
 *
 *   async discover(signal) { ... }
 *   async probe(candidate) { ... }
 *   async readState(device) { ... }
 *
 *   async execute(device, cmd) {
 *     try {
 *       await this.api.send(cmd);
 *       return this.ok(device, cmd.capability, cmd.instance);
 *     } catch (e) {
 *       return this.err(device, cmd, 'API_ERROR', e);
 *     }
 *   }
 * }
 * ```
 */

import log from 'electron-log/main.js';
import type {
  CapabilityType,
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceDriver,
  DiscoveredDevice,
  DriverId,
} from '@smarthome/shared';
import { getErrorMessage } from '@smarthome/shared';

/**
 * Базовый класс, реализующий {@link DeviceDriver}.
 *
 * Subclass обязан определить {@link id}, {@link displayName} и четыре
 * abstract lifecycle-метода. {@link shutdown} переопределяется только если
 * driver держит sockets, timer'ы или watcher'ы.
 */
export abstract class BaseDriver implements DeviceDriver {
  /** Driver-идентификатор — должен совпадать с одним из {@link DriverId}. */
  abstract readonly id: DriverId;

  /** Локализованное имя для integration marketplace. */
  abstract readonly displayName: string;

  /**
   * Найти кандидатов в network'е или cloud'е.
   *
   * Имплементация должна уважать `signal` — корректно отменяться когда юзер
   * уходит со страницы Discovery или запускает новый scan.
   *
   * @param signal - Abort'ится фреймворком когда discovery надо остановить.
   * @returns Список несопряжённых кандидатов. Может содержать дубли с
   *          предыдущих run'ов — registry дедуплицирует по
   *          `(driver, externalId)`.
   */
  abstract discover(signal: AbortSignal): Promise<DiscoveredDevice[]>;

  /**
   * Валидировать кандидата и собрать полноценный {@link Device}.
   *
   * Вызывается когда юзер подтверждает pairing. Драйверы здесь подтягивают
   * полную capability-метадату (часто follow-up HTTP/UDP probe'ом) и
   * возвращают `null` если кандидат оказался unsupported или unreachable.
   *
   * @param candidate - Возвращён ранее из {@link discover}.
   * @returns Готовый device для сохранения, либо `null` чтобы отменить pair.
   */
  abstract probe(candidate: DiscoveredDevice): Promise<Device | null>;

  /**
   * Обновить live-state сопряжённого устройства.
   *
   * Вызывается `PollingService` и UI-actions (refresh-by-click). Должен
   * вернуть device со свежими `capabilities`, `properties`, `status`.
   * При failure — вернуть device со `status: 'unreachable'`, а НЕ бросить
   * исключение: тогда UI продолжит рендерить last-known snapshot.
   *
   * @param device - Существующий сопряжённый device.
   * @returns Тот же device с обновлённым state.
   */
  abstract readState(device: Device): Promise<Device>;

  /**
   * Применить user-команду на устройство.
   *
   * @param device - Целевое устройство.
   * @param command - Что сделать — см. {@link DeviceCommand}.
   * @returns Outcome envelope — см. {@link DeviceCommandResult}.
   */
  abstract execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult>;

  /**
   * Освободить resources перед выходом приложения (sockets, timer'ы,
   * WebSocket'ы, subscription'ы). Default — no-op; override при необходимости.
   *
   * Хаб вызывает с 5-секундным grace-period в graceful-shutdown sequence.
   */
  async shutdown(): Promise<void> {}

  /**
   * Сконструировать успешный {@link DeviceCommandResult}.
   *
   * @param device - Устройство на которое слали команду.
   * @param capability - Capability к которой применилась команда.
   * @param instance - Sub-capability instance (`'on'`, `'rgb'`, …).
   */
  protected ok(device: Device, capability: CapabilityType, instance: string): DeviceCommandResult {
    return { deviceId: device.id, capability, instance, status: 'DONE' };
  }

  /**
   * Сконструировать failed {@link DeviceCommandResult}.
   *
   * Принимает либо строку, либо caught `unknown` (обычно `Error`); во втором
   * случае `.message` извлекается через {@link getErrorMessage}.
   *
   * @param device - Устройство на которое слали команду.
   * @param command - Исходная команда (capability + instance копируются в result).
   * @param code - Machine-readable категория ошибки: `'YANDEX_HTTP_ERROR'`,
   *               `'TIMEOUT'`, `'AUTH_REQUIRED'`. Renderer выбирает
   *               retry/blacklist policy по этому коду.
   * @param messageOrError - Опционально: строка либо caught error/unknown.
   *                          Превращается в human-readable `errorMessage`,
   *                          который показывается в toast'ах.
   */
  protected err(
    device: Device,
    command: DeviceCommand,
    code: string,
    messageOrError?: unknown,
  ): DeviceCommandResult {
    return {
      deviceId: device.id,
      capability: command.capability,
      instance: command.instance,
      status: 'ERROR',
      errorCode: code,
      errorMessage:
        messageOrError === undefined
          ? undefined
          : typeof messageOrError === 'string'
            ? messageOrError
            : getErrorMessage(messageOrError),
    };
  }

  /**
   * Залогировать warning с префиксом из driver id (для удобного grep'а).
   *
   * @example `[yandex-iot] readState(abc-123) snapshot fetch failed: timeout`
   */
  protected logWarn(message: string, e?: unknown): void {
    log.warn(`[${this.id}] ${message}${e !== undefined ? ': ' + getErrorMessage(e) : ''}`);
  }

  /** Залогировать info с префиксом из driver id. */
  protected logInfo(message: string): void {
    log.info(`[${this.id}] ${message}`);
  }
}
