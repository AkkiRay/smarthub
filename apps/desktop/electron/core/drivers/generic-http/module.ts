import type { DriverModule } from '../driver-module.js';
import { GenericHttpDriver } from './generic-http-driver.js';

export const genericHttpModule: DriverModule = {
  descriptor: {
    id: 'generic-http',
    displayName: 'Generic HTTP',
    description: 'Произвольное HTTP-устройство (REST endpoint). Без discovery — вводится вручную.',
    category: 'misc',
    region: 'global',
    brandColor: '#888888',
    requiresCredentials: false,
    supportedTypes: ['switch', 'socket'],
    maturity: 'stable',
  },
  async create() {
    return new GenericHttpDriver();
  },
};
