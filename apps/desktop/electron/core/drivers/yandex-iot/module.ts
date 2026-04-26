import log from 'electron-log/main.js';
import type { DriverModule } from '../driver-module.js';
import { YandexIotDriver } from './yandex-iot-driver.js';

export const yandexIotModule: DriverModule = {
  descriptor: {
    id: 'yandex-iot',
    displayName: 'Дом с Алисой',
    description:
      'Все устройства, привязанные к вашему аккаунту Яндекса (свет, розетки, климат, ТВ, ' +
      'роботы-пылесосы и т.д.). Управляются через iot.quasar.yandex.ru.',
    category: 'cloud-russian',
    region: 'ru',
    brandColor: '#FFCC00',
    iconSlug: 'yandex',
    requiresCredentials: true,
    supportedTypes: [
      'devices.types.light',
      'devices.types.socket',
      'devices.types.switch',
      'devices.types.sensor',
      'devices.types.thermostat',
      'devices.types.media_device',
      'devices.types.vacuum_cleaner',
      'devices.types.humidifier',
      'devices.types.purifier',
      'devices.types.fan',
      'devices.types.openable',
    ],
    maturity: 'beta',
    docsUrl: 'https://yandex.ru/dev/dialogs/smart-home/',
  },
  async create({ settings }) {
    const auth = settings.get('quasarAuth');
    if (!auth?.musicToken) {
      log.info('DriverRegistry: yandex-iot disabled (no Yandex auth)');
      return null;
    }
    log.info('DriverRegistry: yandex-iot enabled — registering driver');
    return new YandexIotDriver();
  },
};
