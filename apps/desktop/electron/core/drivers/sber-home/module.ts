import type { DriverModule } from '../driver-module.js';
import { SberHomeDriver } from './sber-home-driver.js';

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
        key: 'accessToken',
        label: 'Sber ID Access token',
        kind: 'password',
        hint: 'OAuth токен Сбер ID. Получите через помощник «Войти через Сбер ID» в этом окне.',
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
};
