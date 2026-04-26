import type { DriverModule } from '../driver-module.js';
import { WizDriver } from './wiz-driver.js';

export const wizModule: DriverModule = {
  descriptor: {
    id: 'wiz',
    displayName: 'WiZ',
    description: 'Лампы Philips WiZ. Локальный UDP (порт 38899) — без облака и аккаунтов.',
    category: 'lan-global',
    region: 'global',
    brandColor: '#FFB300',
    requiresCredentials: false,
    supportedTypes: ['light'],
    maturity: 'stable',
    docsUrl: 'https://github.com/sbidy/pywizlight',
  },
  async create() {
    return new WizDriver();
  },
};
