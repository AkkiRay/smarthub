import type { DriverModule } from '../driver-module.js';
import { HueDriver } from './hue-driver.js';

export const hueModule: DriverModule = {
  descriptor: {
    id: 'hue',
    displayName: 'Philips Hue',
    description: 'Локальный Hue Bridge REST API. Поддерживает Hue/Friends-of-Hue/IKEA через мост.',
    category: 'lan-global',
    region: 'global',
    brandColor: '#FFA200',
    requiresCredentials: true,
    supportedTypes: ['light'],
    maturity: 'stable',
    docsUrl: 'https://developers.meethue.com/develop/hue-api/',
    credentialsSchema: [
      {
        key: 'bridges',
        label: 'Bridges (JSON)',
        kind: 'text',
        placeholder: '[{"bridgeId":"abc","internalipaddress":"192.168.1.10","username":"..."}]',
        hint: 'Сохраняется автоматически после нажатия кнопки на мосту в UI «Найти мост».',
      },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('hue') as { bridges?: string };
    if (!c.bridges) return null;
    let bridges: Array<{ bridgeId: string; internalipaddress: string; username: string }> = [];
    try {
      bridges = JSON.parse(c.bridges);
    } catch {
      return null;
    }
    if (!Array.isArray(bridges) || bridges.length === 0) return null;
    return new HueDriver(bridges);
  },
};
