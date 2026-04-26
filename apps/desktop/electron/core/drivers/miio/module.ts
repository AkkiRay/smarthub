import type { DriverModule } from '../driver-module.js';
import { MiIODriver } from './miio-driver.js';

export const miioModule: DriverModule = {
  descriptor: {
    id: 'miio',
    displayName: 'Mi Home (Local)',
    description:
      'Локальный miIO-протокол: Xiaomi/Mi/Aqara/Roborock/Yeelight Gateway. Требует device token (32 hex).',
    category: 'lan-global',
    region: 'global',
    brandColor: '#FF6700',
    requiresCredentials: true,
    supportedTypes: [
      'light',
      'socket',
      'sensor',
      'humidifier',
      'purifier',
      'vacuum_cleaner',
      'fan',
    ],
    maturity: 'beta',
    docsUrl: 'https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor',
    credentialsSchema: [
      {
        key: 'devices',
        label: 'Устройства (JSON)',
        kind: 'text',
        placeholder: '[{"did":12345,"token":"32-hex","model":"yeelink.light.color1"}]',
        hint: 'Извлекается из Mi Home App или Xiaomi-cloud-tokens-extractor.',
        required: true,
      },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('miio') as { devices?: string };
    if (!c.devices) return null;
    let parsed: Array<{ did: number; token: string; model?: string; name?: string; ip?: string }>;
    try {
      parsed = JSON.parse(c.devices);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return new MiIODriver(parsed);
  },
};
