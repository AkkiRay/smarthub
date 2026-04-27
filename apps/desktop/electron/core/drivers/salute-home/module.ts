import type { DriverModule } from '../driver-module.js';
import { SaluteHomeDriver } from './salute-home-driver.js';
import { probeViaDiscover } from '../_shared/probe-via-discover.js';

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
        key: '__register',
        kind: 'register-link',
        label: 'Открыть портал «Sber Developer»',
        hint: 'Workspace → Salute / IoT product → Access token + Refresh token. Тот же Sber ID, что и Сбер Дом.',
        url: 'https://developers.sber.ru/studio/workspaces',
      },
      {
        key: 'accessToken',
        label: 'Sber ID Access token',
        kind: 'password',
        required: true,
        hint: 'OAuth-токен Sber ID. Один Sber ID может покрывать сразу Sber Smart Home и SaluteHome.',
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
      { key: '__test', kind: 'test-button', label: 'Проверить' },
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
  async probe(values) {
    if (!values['accessToken']) {
      return { ok: false, message: 'Введите Access token' };
    }
    const scope = (values['scope'] as 'IOT' | 'COMPANION' | undefined) ?? 'IOT';
    return probeViaDiscover(
      async () =>
        new SaluteHomeDriver({
          accessToken: values['accessToken']!,
          refreshToken: values['refreshToken'] || undefined,
          scope,
        }),
    );
  },
};
