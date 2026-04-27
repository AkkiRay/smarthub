import type { DriverModule } from '../driver-module.js';
import { EWeLinkDriver } from './ewelink-driver.js';
import { probeViaDiscover } from '../_shared/probe-via-discover.js';
import { defaultRegion } from '../_shared/region-detect.js';

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
      {
        key: '__register',
        kind: 'register-link',
        label: 'Открыть eWeLink Developer Console',
        hint: 'Зарегистрируйте приложение → App ID + App Secret. Email/пароль — те же, что в приложении eWeLink.',
        url: 'https://dev.ewelink.cc/console',
      },
      { key: 'email', label: 'Email', kind: 'text', required: true },
      { key: 'password', label: 'Пароль', kind: 'password', required: true },
      { key: 'appId', label: 'App ID', kind: 'text', required: true },
      { key: 'appSecret', label: 'App Secret', kind: 'password', required: true },
      {
        key: 'region',
        label: 'Регион',
        kind: 'select',
        defaultValue: defaultRegion('ewelink'),
        options: [
          { value: 'eu', label: 'Europe' },
          { value: 'us', label: 'United States' },
          { value: 'cn', label: 'China' },
          { value: 'as', label: 'Asia' },
        ],
      },
      { key: '__test', kind: 'test-button', label: 'Проверить' },
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
  async probe(values) {
    if (!values['email'] || !values['password'] || !values['appId'] || !values['appSecret']) {
      return { ok: false, message: 'Заполните email, пароль, App ID и App Secret' };
    }
    return probeViaDiscover(
      async () =>
        new EWeLinkDriver({
          email: values['email']!,
          password: values['password']!,
          appId: values['appId']!,
          appSecret: values['appSecret']!,
          region: (values['region'] as 'eu' | 'us' | 'cn' | 'as' | undefined) ?? 'eu',
        }),
    );
  },
};
