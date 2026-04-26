import type { DriverModule } from '../driver-module.js';
import { HomeKitDriver } from './homekit-driver.js';

export const homekitModule: DriverModule = {
  descriptor: {
    id: 'homekit',
    displayName: 'Apple HomeKit',
    description:
      'Apple HAP-аксессуары. Discovery через mDNS — для управления требуется HAP controller (hap-controller).',
    category: 'protocol',
    region: 'global',
    brandColor: '#000000',
    requiresCredentials: false,
    supportedTypes: ['light', 'socket', 'switch', 'sensor', 'thermostat', 'fan', 'camera', 'lock'],
    maturity: 'planned',
    docsUrl: 'https://developer.apple.com/documentation/homekit',
  },
  async create() {
    return new HomeKitDriver();
  },
};
