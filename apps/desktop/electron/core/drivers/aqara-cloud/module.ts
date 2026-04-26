import type { DriverModule } from '../driver-module.js';
import { AqaraCloudDriver } from './aqara-cloud-driver.js';

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
      { key: 'appId', label: 'App ID', kind: 'text', required: true },
      { key: 'appKey', label: 'App Key', kind: 'password', required: true },
      { key: 'keyId', label: 'Key ID', kind: 'text', required: true },
      { key: 'accessToken', label: 'Access token', kind: 'password', required: true },
      { key: 'refreshToken', label: 'Refresh token', kind: 'password' },
      {
        key: 'region',
        label: 'Регион',
        kind: 'select',
        defaultValue: 'eu',
        options: [
          { value: 'cn', label: 'China' },
          { value: 'usa', label: 'USA' },
          { value: 'eu', label: 'Europe' },
          { value: 'sg', label: 'Singapore' },
          { value: 'kr', label: 'Korea' },
          { value: 'ru', label: 'Russia' },
        ],
      },
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
    return new AqaraCloudDriver({
      appId: c.appId,
      appKey: c.appKey,
      keyId: c.keyId,
      accessToken: c.accessToken,
      refreshToken: c.refreshToken,
      region: c.region ?? 'eu',
    });
  },
};
