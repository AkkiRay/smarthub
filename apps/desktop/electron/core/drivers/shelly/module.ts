import type { DriverModule } from '../driver-module.js';
import { ShellyDriver } from './shelly-driver.js';

export const shellyModule: DriverModule = {
  descriptor: {
    id: 'shelly',
    displayName: 'Shelly',
    description: 'Shelly Gen1/Gen2 — локальный HTTP RPC API + mDNS.',
    category: 'lan-global',
    region: 'global',
    brandColor: '#FAB400',
    requiresCredentials: false,
    supportedTypes: ['socket', 'switch', 'light'],
    maturity: 'stable',
    docsUrl: 'https://shelly-api-docs.shelly.cloud/',
  },
  async create({ settings }) {
    // Опциональный password — для устройств с auth_en=true (Gen2+).
    const creds = settings.getDriverCredentials('shelly') as { password?: string };
    return new ShellyDriver({ ...(creds.password ? { password: creds.password } : {}) });
  },
};
