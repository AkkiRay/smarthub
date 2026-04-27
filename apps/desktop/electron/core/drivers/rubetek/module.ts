import type { DriverModule } from '../driver-module.js';
import { RubetekDriver } from './rubetek-driver.js';
import { probeViaDiscover } from '../_shared/probe-via-discover.js';

export const rubetekModule: DriverModule = {
  descriptor: {
    id: 'rubetek',
    displayName: 'Rubetek',
    description: 'Облако Rubetek (РФ) — лампы, розетки, датчики, замки.',
    category: 'cloud-russian',
    region: 'ru',
    brandColor: '#E62E2E',
    requiresCredentials: true,
    supportedTypes: ['light', 'socket', 'switch', 'sensor', 'thermostat', 'lock', 'camera'],
    maturity: 'planned',
    docsUrl: 'https://rubetek.com',
    credentialsSchema: [
      {
        key: '__register',
        kind: 'register-link',
        label: 'Открыть «Rubetek»',
        hint: 'Используйте логин/пароль из мобильного приложения Rubetek.',
        url: 'https://rubetek.com',
      },
      { key: 'email', label: 'Email Rubetek', kind: 'text', required: true },
      { key: 'password', label: 'Пароль', kind: 'password', required: true },
      {
        key: 'houseId',
        label: 'House ID',
        kind: 'text',
        hint: 'Опционально — фильтр по конкретному дому.',
      },
      { key: '__test', kind: 'test-button', label: 'Проверить' },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('rubetek') as {
      email?: string;
      password?: string;
      houseId?: string;
    };
    if (!c.email || !c.password) return null;
    return new RubetekDriver({
      email: c.email,
      password: c.password,
      houseId: c.houseId,
    });
  },
  async probe(values) {
    if (!values['email'] || !values['password']) {
      return { ok: false, message: 'Введите email и пароль' };
    }
    return probeViaDiscover(
      async () =>
        new RubetekDriver({
          email: values['email']!,
          password: values['password']!,
          houseId: values['houseId'] || undefined,
        }),
    );
  },
};
