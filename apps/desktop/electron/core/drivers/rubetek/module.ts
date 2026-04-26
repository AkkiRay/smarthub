import type { DriverModule } from '../driver-module.js';
import { RubetekDriver } from './rubetek-driver.js';

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
      { key: 'email', label: 'Email Rubetek', kind: 'text', required: true },
      { key: 'password', label: 'Пароль', kind: 'password', required: true },
      {
        key: 'houseId',
        label: 'House ID',
        kind: 'text',
        hint: 'Опционально — фильтр по конкретному дому.',
      },
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
};
