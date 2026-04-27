import type { DriverModule } from '../driver-module.js';
import { TPLinkCloudDriver } from './tplink-cloud-driver.js';
import { probeViaDiscover } from '../_shared/probe-via-discover.js';

export const tplinkCloudModule: DriverModule = {
  descriptor: {
    id: 'tplink-cloud',
    displayName: 'TP-Link Cloud (Kasa+Tapo)',
    description:
      'Облако TP-Link — закрывает обе линейки Kasa и Tapo одним аккаунтом, без зависимости от прошивки KLAP.',
    category: 'cloud-global',
    region: 'global',
    brandColor: '#0F58FF',
    requiresCredentials: true,
    supportedTypes: ['light', 'socket'],
    maturity: 'beta',
    docsUrl: 'https://github.com/plasticrake/tplink-cloud-api',
    credentialsSchema: [
      {
        key: '__register',
        kind: 'register-link',
        label: 'Открыть TP-Link ID',
        hint: 'Используйте логин/пароль из приложения Kasa или Tapo. Регистрация — на сайте TP-Link.',
        url: 'https://www.tp-link.com/us/account/login.html',
      },
      { key: 'email', label: 'Email TP-Link ID', kind: 'text', required: true },
      { key: 'password', label: 'Пароль TP-Link ID', kind: 'password', required: true },
      { key: '__test', kind: 'test-button', label: 'Проверить' },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('tplink-cloud') as {
      email?: string;
      password?: string;
    };
    if (!c.email || !c.password) return null;
    return new TPLinkCloudDriver({ email: c.email, password: c.password });
  },
  async probe(values) {
    if (!values['email'] || !values['password']) {
      return { ok: false, message: 'Введите email и пароль' };
    }
    return probeViaDiscover(
      async () => new TPLinkCloudDriver({ email: values['email']!, password: values['password']! }),
    );
  },
};
