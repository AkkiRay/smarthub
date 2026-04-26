import type { DriverModule } from '../driver-module.js';
import { WemoDriver } from './wemo-driver.js';

export const wemoModule: DriverModule = {
  descriptor: {
    id: 'wemo',
    displayName: 'Belkin WeMo',
    description: 'Belkin WeMo Switch/Insight/Mini. SSDP + SOAP, без облака.',
    category: 'lan-global',
    region: 'global',
    brandColor: '#00ADEF',
    requiresCredentials: false,
    supportedTypes: ['socket'],
    maturity: 'stable',
  },
  async create() {
    return new WemoDriver();
  },
};
