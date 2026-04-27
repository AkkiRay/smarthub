import type { DriverModule } from '../driver-module.js';
import { DirigeraDriver } from './dirigera-driver.js';

export const dirigeraModule: DriverModule = {
  descriptor: {
    id: 'dirigera',
    displayName: 'IKEA DIRIGERA',
    description: 'Локальный шлюз IKEA DIRIGERA. PKCE-pairing с физической кнопкой на хабе.',
    category: 'lan-global',
    region: 'global',
    brandColor: '#0058A3',
    requiresCredentials: true,
    supportedTypes: ['light', 'socket', 'sensor', 'openable.curtain'],
    maturity: 'beta',
    docsUrl: 'https://github.com/Leggin/dirigera',
    credentialsSchema: [
      {
        key: 'host',
        label: 'IP / hostname шлюза',
        kind: 'discover-host',
        placeholder: '192.168.1.20',
        required: true,
      },
      {
        key: 'accessToken',
        label: 'Access token',
        kind: 'password',
        hint: 'Получается через PKCE-pairing — UI откроет помощник.',
        required: true,
      },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('dirigera') as {
      host?: string;
      accessToken?: string;
      certFingerprint?: string;
    };
    if (!c.host || !c.accessToken) return null;
    return new DirigeraDriver(
      {
        host: c.host,
        accessToken: c.accessToken,
        ...(c.certFingerprint ? { certFingerprint: c.certFingerprint } : {}),
      },
      // TOFU pin'инг при первом use; persist'им чтобы rotation cert'а на firmware
      // update сломал пайплайн с явной ошибкой, а не молча MITM-уязвимостью.
      (fingerprint) => {
        const existing = settings.getDriverCredentials('dirigera');
        settings.setDriverCredentials('dirigera', {
          ...existing,
          certFingerprint: fingerprint,
        } as never);
      },
    );
  },
};
