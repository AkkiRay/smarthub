import type { DriverModule } from '../driver-module.js';
import { TuyaDriver } from './tuya-driver.js';

export const tuyaModule: DriverModule = {
  descriptor: {
    id: 'tuya',
    displayName: 'Tuya / Smart Life',
    description:
      'Tuya Cloud API — Smart Life и десятки ребрендов (HIPER IoT, Digma, Polaris и др.).',
    category: 'cloud-global',
    region: 'global',
    brandColor: '#FF4800',
    requiresCredentials: true,
    supportedTypes: ['light', 'socket', 'switch', 'sensor', 'thermostat', 'vacuum_cleaner'],
    maturity: 'stable',
    docsUrl: 'https://developer.tuya.com/en/docs/iot/api-reference?id=Ka431f4ub0r1u',
    credentialsSchema: [
      {
        key: 'apiKey',
        label: 'API Key',
        kind: 'text',
        placeholder: 't-xxxxxxxxxxxxxxxx',
        required: true,
      },
      {
        key: 'apiSecret',
        label: 'API Secret',
        kind: 'password',
        placeholder: '••••••••••••',
        required: true,
      },
      {
        key: 'uid',
        label: 'UID',
        kind: 'text',
        hint: 'Только если устройства привязаны к конкретному пользователю.',
      },
      {
        key: 'region',
        label: 'Регион',
        kind: 'select',
        defaultValue: 'eu',
        options: [
          { value: 'eu', label: 'Europe (eu)' },
          { value: 'us', label: 'United States (us)' },
          { value: 'cn', label: 'China (cn)' },
          { value: 'in', label: 'India (in)' },
        ],
      },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('tuya') as {
      apiKey?: string;
      apiSecret?: string;
      region?: string;
      uid?: string;
    };
    if (!c.apiKey || !c.apiSecret) return null;
    return new TuyaDriver({
      apiKey: c.apiKey,
      apiSecret: c.apiSecret,
      region: c.region,
      uid: c.uid,
    });
  },
};
