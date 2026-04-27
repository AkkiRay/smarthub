import type { DriverModule } from '../driver-module.js';
import { EWeLinkDriver } from './ewelink-driver.js';

export const ewelinkModule: DriverModule = {
  descriptor: {
    id: 'ewelink',
    displayName: 'eWeLink (Sonoff)',
    description: 'Облако eWeLink — Sonoff, ITEAD и совместимые устройства.',
    category: 'cloud-global',
    region: 'global',
    brandColor: '#0CABC8',
    requiresCredentials: true,
    supportedTypes: ['light', 'socket', 'switch', 'sensor'],
    maturity: 'beta',
    docsUrl: 'https://coolkit-technologies.github.io/eWeLink-API/#/en/',
    credentialsSchema: [
      { key: 'email', label: 'Email', kind: 'text', required: true },
      { key: 'password', label: 'Пароль', kind: 'password', required: true },
      { key: 'appId', label: 'App ID', kind: 'text', required: true },
      { key: 'appSecret', label: 'App Secret', kind: 'password', required: true },
      {
        key: 'region',
        label: 'Регион',
        kind: 'select',
        defaultValue: 'eu',
        options: [
          { value: 'eu', label: 'Europe' },
          { value: 'us', label: 'United States' },
          { value: 'cn', label: 'China' },
          { value: 'as', label: 'Asia' },
        ],
      },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('ewelink') as {
      email?: string;
      password?: string;
      appId?: string;
      appSecret?: string;
      region?: 'eu' | 'us' | 'cn' | 'as';
      accessToken?: string;
      refreshToken?: string;
    };
    if (!c.email || !c.password || !c.appId || !c.appSecret) return null;
    return new EWeLinkDriver(
      {
        email: c.email,
        password: c.password,
        appId: c.appId,
        appSecret: c.appSecret,
        region: c.region ?? 'eu',
        ...(c.accessToken ? { accessToken: c.accessToken } : {}),
        ...(c.refreshToken ? { refreshToken: c.refreshToken } : {}),
      },
      // Persist ротированных токенов: eWeLink выдаёт новые at+rt на каждый refresh.
      // Без этого после restart'а приложения rt=stale → re-login email/password (rate-limit).
      ({ accessToken, refreshToken }) => {
        const existing = settings.getDriverCredentials('ewelink');
        settings.setDriverCredentials('ewelink', {
          ...existing,
          accessToken,
          refreshToken,
        } as never);
      },
    );
  },
};
