import type { DriverModule } from '../driver-module.js';
import { TuyaDriver } from './tuya-driver.js';
import { probeViaDiscover } from '../_shared/probe-via-discover.js';
import { defaultRegion } from '../_shared/region-detect.js';

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
        key: '__register',
        kind: 'register-link',
        label: 'Открыть Tuya IoT Cloud',
        hint: 'Cloud → Projects → Create. Укажите Smart Home → IoT Core. Скопируйте Access ID = API Key, Access Secret = API Secret.',
        url: 'https://platform.tuya.com/cloud/projects',
      },
      {
        key: 'apiKey',
        label: 'API Key (Access ID)',
        kind: 'text',
        placeholder: 't-xxxxxxxxxxxxxxxx',
        required: true,
      },
      {
        key: 'apiSecret',
        label: 'API Secret (Access Secret)',
        kind: 'password',
        placeholder: '••••••••••••',
        required: true,
      },
      {
        key: 'uid',
        label: 'UID',
        kind: 'text',
        hint: 'Tuya IoT Cloud → Project → Devices → Link Tuya App Account → User ID. Без UID хаб не сможет получить список устройств.',
      },
      {
        key: 'region',
        label: 'Регион',
        kind: 'select',
        defaultValue: defaultRegion('tuya'),
        options: [
          { value: 'eu', label: 'Europe (eu)' },
          { value: 'us', label: 'United States (us)' },
          { value: 'cn', label: 'China (cn)' },
          { value: 'in', label: 'India (in)' },
        ],
      },
      { key: '__test', kind: 'test-button', label: 'Проверить' },
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
  async probe(values) {
    if (!values['apiKey'] || !values['apiSecret']) {
      return { ok: false, message: 'Введите API Key и API Secret' };
    }
    return probeViaDiscover(
      async () =>
        new TuyaDriver({
          apiKey: values['apiKey']!,
          apiSecret: values['apiSecret']!,
          region: values['region'] || undefined,
          uid: values['uid'] || undefined,
        }),
    );
  },
};
