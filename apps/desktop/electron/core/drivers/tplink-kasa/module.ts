import type { DriverModule } from '../driver-module.js';
import { TPLinkKasaDriver } from './tplink-kasa-driver.js';

export const tplinkKasaModule: DriverModule = {
  descriptor: {
    id: 'tplink-kasa',
    displayName: 'TP-Link Kasa',
    description:
      'Старая линейка TP-Link Kasa: HS100/HS103/HS105/HS110/HS200/KL-серия. Локальный TCP 9999.',
    category: 'lan-global',
    region: 'global',
    brandColor: '#4ACAA8',
    requiresCredentials: false,
    supportedTypes: ['light', 'socket', 'switch'],
    maturity: 'stable',
    docsUrl: 'https://github.com/python-kasa/python-kasa',
  },
  async create() {
    return new TPLinkKasaDriver();
  },
};
