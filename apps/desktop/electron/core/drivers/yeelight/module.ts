import type { DriverModule } from '../driver-module.js';
import { YeelightDriver } from './yeelight-driver.js';

export const yeelightModule: DriverModule = {
  descriptor: {
    id: 'yeelight',
    displayName: 'Yeelight',
    description: 'Xiaomi Yeelight LAN-протокол (TCP, порт 55443). Без облака.',
    category: 'lan-global',
    region: 'global',
    brandColor: '#3F8CFF',
    requiresCredentials: false,
    supportedTypes: ['light'],
    maturity: 'stable',
    docsUrl: 'https://www.yeelight.com/download/Yeelight_Inter-Operation_Spec.pdf',
  },
  async create() {
    return new YeelightDriver();
  },
};
