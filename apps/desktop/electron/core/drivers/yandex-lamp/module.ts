import type { DriverModule } from '../driver-module.js';
import { YandexLampDriver } from './yandex-lamp-driver.js';

export const yandexLampModule: DriverModule = {
  descriptor: {
    id: 'yandex-lamp',
    displayName: 'Яндекс Лампочка',
    description:
      'Детектирует Яндекс Лампочки YNDX-XXXXX в локальной сети по UDP-broadcast Tuya (порт 6667). ' +
      'Управлять напрямую без привязки нельзя — после пары через приложение «Дом с Алисой» ' +
      'хаб автоматически подтянет лампочки через yandex-iot driver.',
    category: 'lan-russian',
    region: 'ru',
    brandColor: '#FFCC00',
    iconSlug: 'yandex',
    requiresCredentials: false,
    supportedTypes: ['devices.types.light'],
    maturity: 'beta',
    docsUrl: 'https://yandex.ru/support/smart-home/',
  },
  async create() {
    return new YandexLampDriver();
  },
};
