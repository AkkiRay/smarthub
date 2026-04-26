import type { DriverModule } from '../driver-module.js';
import { TPLinkCloudDriver } from './tplink-cloud-driver.js';

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
      { key: 'email', label: 'Email TP-Link ID', kind: 'text', required: true },
      { key: 'password', label: 'Пароль TP-Link ID', kind: 'password', required: true },
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
};
