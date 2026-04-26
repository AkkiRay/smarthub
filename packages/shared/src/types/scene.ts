// Scenes: composite команды по нескольким устройствам.

import type { CapabilityType } from './device.js';

export interface SceneAction {
  deviceId: string;
  capability: CapabilityType;
  instance: string;
  value: unknown;
  /** ms задержка относительно старта сценария. */
  delayMs?: number;
}

export interface Scene {
  id: string;
  name: string;
  /** Inline SVG-разметка. */
  icon: string;
  /** HEX-акцент для градиента. */
  accent: string;
  actions: SceneAction[];
  /** true → хаб шлёт serverAction в Yandex Station, сценарий вызывается голосом. */
  exposeToStation: boolean;
  createdAt: string;
  updatedAt: string;
}
