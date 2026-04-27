import type { DriverModule } from '../driver-module.js';
import { SberHomeDriver } from './sber-home-driver.js';
import { probeViaDiscover } from '../_shared/probe-via-discover.js';

export const sberHomeModule: DriverModule = {
  descriptor: {
    id: 'sber-home',
    displayName: 'Сбер Дом',
    description:
      'Облачный API «Сбер Дом» (Sber Smart Home). Лампочки, розетки, термостаты Sber Salute и партнёров.',
    category: 'cloud-russian',
    region: 'ru',
    brandColor: '#21A038',
    requiresCredentials: true,
    supportedTypes: ['light', 'socket', 'switch', 'sensor', 'thermostat', 'media_device.tv'],
    maturity: 'beta',
    docsUrl: 'https://developers.sber.ru/portal/products/sber-smart-home',
    credentialsSchema: [
      {
        key: '__register',
        kind: 'register-link',
        label: 'Открыть портал «Sber Developer»',
        hint: 'Создайте приложение → Smart Home → скопируйте Access token и Refresh token сюда.',
        url: 'https://developers.sber.ru/studio/workspaces',
      },
      {
        key: 'accessToken',
        label: 'Sber ID Access token',
        kind: 'password',
        hint: 'OAuth-токен из портала Sber Developer (Smart Home product).',
        required: true,
      },
      {
        key: 'refreshToken',
        label: 'Refresh token',
        kind: 'password',
        hint: 'Опционально — позволяет авто-обновлять access_token при истечении.',
      },
      {
        key: 'houseId',
        label: 'House ID',
        kind: 'text',
        hint: 'Опционально — если в аккаунте несколько домов, фильтруем по конкретному.',
      },
      { key: '__test', kind: 'test-button', label: 'Проверить' },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('sber-home') as {
      accessToken?: string;
      refreshToken?: string;
      houseId?: string;
    };
    if (!c.accessToken) return null;
    return new SberHomeDriver({
      accessToken: c.accessToken,
      refreshToken: c.refreshToken,
      houseId: c.houseId,
    });
  },
  async probe(values) {
    if (!values['accessToken']) {
      return { ok: false, message: 'Введите Sber ID Access token' };
    }
    return probeViaDiscover(
      async () =>
        new SberHomeDriver({
          accessToken: values['accessToken']!,
          refreshToken: values['refreshToken'] || undefined,
          houseId: values['houseId'] || undefined,
        }),
    );
  },
};
