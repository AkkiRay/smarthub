import type { DriverModule } from '../driver-module.js';
import { SaluteHomeDriver } from './salute-home-driver.js';

export const saluteHomeModule: DriverModule = {
  descriptor: {
    id: 'salute-home',
    displayName: 'SaluteHome',
    description:
      'Облако SberDevices «Салют» — умные колонки SberBoom/SberPortal + smart-home + сценарные фразы.',
    category: 'cloud-russian',
    region: 'ru',
    brandColor: '#21A038',
    requiresCredentials: true,
    supportedTypes: ['light', 'socket', 'switch', 'sensor', 'media_device', 'media_device.tv'],
    maturity: 'beta',
    docsUrl: 'https://developers.sber.ru/portal/products/salute-home',
    credentialsSchema: [
      {
        key: 'accessToken',
        label: 'Sber ID Access token',
        kind: 'password',
        required: true,
      },
      { key: 'refreshToken', label: 'Refresh token', kind: 'password' },
      {
        key: 'scope',
        label: 'Scope',
        kind: 'select',
        defaultValue: 'IOT',
        options: [
          { value: 'IOT', label: 'IoT (умный дом)' },
          { value: 'COMPANION', label: 'COMPANION (Салют-ассистенты)' },
        ],
      },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('salute-home') as {
      accessToken?: string;
      refreshToken?: string;
      scope?: 'IOT' | 'COMPANION';
    };
    if (!c.accessToken) return null;
    return new SaluteHomeDriver({
      accessToken: c.accessToken,
      refreshToken: c.refreshToken,
      scope: c.scope ?? 'IOT',
    });
  },
};
