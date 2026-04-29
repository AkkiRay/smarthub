/**
 * @fileoverview Scene — composite-команда по нескольким устройствам с
 * опциональной задержкой между шагами. Хранится в `hub.sqlite`, выполняется
 * `SceneService` (см. `electron/core/scenes/scene-service.ts`).
 *
 * При `exposeToStation: true` сценарий регистрируется как virtual `on_off`
 * device у Алисы — и юзер может вызвать его голосом («Алиса, включи
 * романтику»).
 */

import type { CapabilityType } from './device.js';

/**
 * Один шаг сценария — команда на одно устройство, опционально с задержкой
 * относительно момента старта сценария.
 */
export interface SceneAction {
  /** Целевое устройство (`Device.id`). */
  deviceId: string;
  /** Capability на которую действуем. */
  capability: CapabilityType;
  /** Sub-capability instance (`'on'`, `'rgb'`, …). */
  instance: string;
  /** Новое значение. */
  value: unknown;
  /**
   * Задержка относительно старта сценария, мс. По умолчанию 0
   * (выполняется сразу).
   *
   * @example `{ delayMs: 0 }` — turn lights off immediately
   * @example `{ delayMs: 2000 }` — drop blinds 2 seconds later
   */
  delayMs?: number;
}

export type SceneDryRunSeverity = 'ok' | 'warning' | 'error';

export interface SceneDryRunStep {
  index: number;
  delayMs: number;
  deviceId: string;
  deviceName: string;
  deviceStatus: string;
  capability: CapabilityType;
  instance: string;
  value: unknown;
  severity: SceneDryRunSeverity;
  message: string;
}

export interface SceneDryRunReport {
  sceneId: string;
  sceneName: string;
  actionCount: number;
  estimatedDurationMs: number;
  canRun: boolean;
  warnings: number;
  errors: number;
  steps: SceneDryRunStep[];
}

/**
 * Сценарий — именованный набор {@link SceneAction}. Запускается из UI кнопкой
 * или (при `exposeToStation`) голосом через Алису.
 */
export interface Scene {
  /** Внутренний UUID. */
  id: string;
  /** Имя сценария (то что видит юзер). */
  name: string;
  /** Inline SVG-разметка для иконки в UI. */
  icon: string;
  /** HEX-акцент для glass-morphism градиента карточки. */
  accent: string;
  /** Список шагов; порядок выполнения = порядок в массиве + `delayMs`. */
  actions: SceneAction[];
  /**
   * `true` → хаб экспонирует сценарий как virtual `devices.types.other` с
   * capability `on_off` через Alice Smart Home Skill — голосовое включение.
   */
  exposeToStation: boolean;
  /** ISO 8601 момент создания. */
  createdAt: string;
  /** ISO 8601 timestamp последнего изменения. */
  updatedAt: string;
}
