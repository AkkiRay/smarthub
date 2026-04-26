import log from 'electron-log/main.js';
import type { DriverModule } from '../driver-module.js';
import { MockDriver } from './mock-driver.js';

export const mockModule: DriverModule = {
  descriptor: {
    id: 'mock',
    displayName: 'Mock-симулятор',
    description: 'Виртуальные устройства для отладки UI без железа (HUB_ENABLE_MOCK=true).',
    category: 'misc',
    region: 'global',
    brandColor: '#444444',
    requiresCredentials: false,
    supportedTypes: ['light', 'socket', 'thermostat', 'sensor'],
    maturity: 'stable',
  },
  async create() {
    if (process.env['HUB_ENABLE_MOCK'] !== 'true') {
      // Явный лог: частая причина — забыли перезапустить dev-сервер после правки .env.
      log.info(
        `DriverRegistry: mock disabled (HUB_ENABLE_MOCK="${process.env['HUB_ENABLE_MOCK'] ?? ''}")`,
      );
      return null;
    }
    log.info('DriverRegistry: mock enabled — registering MockDriver');
    return new MockDriver();
  },
};
