import type { DriverModule } from '../driver-module.js';
import { AqaraCloudDriver } from './aqara-cloud-driver.js';
import { probeViaDiscover } from '../_shared/probe-via-discover.js';
import { defaultRegion } from '../_shared/region-detect.js';

export const aqaraCloudModule: DriverModule = {
  descriptor: {
    id: 'aqara-cloud',
    displayName: 'Aqara Cloud',
    description: 'Aqara Open Cloud — лампы, розетки, датчики, камеры, замки.',
    category: 'cloud-global',
    region: 'global',
    brandColor: '#00C6F0',
    requiresCredentials: true,
    supportedTypes: ['light', 'socket', 'sensor', 'openable.curtain', 'lock', 'camera'],
    maturity: 'beta',
    docsUrl: 'https://opendoc.aqara.com/',
    credentialsSchema: [
      {
        key: '__register',
        kind: 'register-link',
        label: 'Открыть Aqara Open Console',
        hint: 'Console → Project → Add. После одобрения (1–2 дня) — Auth → Generate auth code → Get token. Скопируйте App ID / App Key / Key ID / Access Token / Refresh Token сюда.',
        url: 'https://developer.aqara.com/console',
      },
      { key: 'appId', label: 'App ID', kind: 'text', required: true },
      { key: 'appKey', label: 'App Key', kind: 'password', required: true },
      { key: 'keyId', label: 'Key ID', kind: 'text', required: true },
      { key: 'accessToken', label: 'Access token', kind: 'password', required: true },
      { key: 'refreshToken', label: 'Refresh token', kind: 'password' },
      {
        key: 'region',
        label: 'Регион',
        kind: 'select',
        defaultValue: defaultRegion('aqara'),
        options: [
          { value: 'cn', label: 'China' },
          { value: 'usa', label: 'USA' },
          { value: 'eu', label: 'Europe' },
          { value: 'sg', label: 'Singapore' },
          { value: 'kr', label: 'Korea' },
          { value: 'ru', label: 'Russia' },
        ],
      },
      { key: '__test', kind: 'test-button', label: 'Проверить' },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('aqara-cloud') as {
      appId?: string;
      appKey?: string;
      keyId?: string;
      accessToken?: string;
      refreshToken?: string;
      region?: 'cn' | 'usa' | 'eu' | 'sg' | 'kr' | 'ru';
    };
    if (!c.appId || !c.appKey || !c.keyId || !c.accessToken) return null;
    return new AqaraCloudDriver(
      {
        appId: c.appId,
        appKey: c.appKey,
        keyId: c.keyId,
        accessToken: c.accessToken,
        refreshToken: c.refreshToken,
        region: c.region ?? 'eu',
      },
      ({ accessToken, refreshToken }) => {
        const existing = settings.getDriverCredentials('aqara-cloud');
        settings.setDriverCredentials('aqara-cloud', {
          ...existing,
          accessToken,
          ...(refreshToken ? { refreshToken } : {}),
        } as never);
      },
    );
  },
  async probe(values) {
    if (!values['appId'] || !values['appKey'] || !values['keyId'] || !values['accessToken']) {
      return { ok: false, message: 'Заполните App ID, App Key, Key ID и Access token' };
    }
    return probeViaDiscover(
      async () =>
        new AqaraCloudDriver({
          appId: values['appId']!,
          appKey: values['appKey']!,
          keyId: values['keyId']!,
          accessToken: values['accessToken']!,
          refreshToken: values['refreshToken'] || undefined,
          region:
            (values['region'] as 'cn' | 'usa' | 'eu' | 'sg' | 'kr' | 'ru' | undefined) ?? 'eu',
        }),
    );
  },
};
