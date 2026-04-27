import type { DriverModule } from '../driver-module.js';
import { TPLinkTapoDriver } from './tplink-tapo-driver.js';

export const tplinkTapoModule: DriverModule = {
  descriptor: {
    id: 'tplink-tapo',
    displayName: 'TP-Link Tapo (Local)',
    description:
      'Tapo P100/P110/L530/L630 локально (HTTP secure-passthrough). На новых прошивках с KLAP — может потребоваться TP-Link Cloud.',
    category: 'lan-global',
    region: 'global',
    brandColor: '#0F58FF',
    requiresCredentials: true,
    supportedTypes: ['light', 'socket'],
    maturity: 'beta',
    docsUrl: 'https://github.com/python-kasa/python-kasa',
    credentialsSchema: [
      { key: 'email', label: 'Email TP-Link ID', kind: 'text', required: true },
      { key: 'password', label: 'Пароль TP-Link ID', kind: 'password', required: true },
      {
        key: 'hosts',
        label: 'IP устройств (опционально)',
        kind: 'text',
        placeholder: 'auto',
        hint: 'Можно оставить пустым — хаб сам опросит /24 LAN-сегмента и найдёт Tapo по KLAP-handshake. Заполните, только если автодискавери не находит устройство (например, в сегменте /16) или нужно ускорить старт.',
      },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('tplink-tapo') as {
      email?: string;
      password?: string;
      hosts?: string;
    };
    if (!c.email || !c.password) return null;
    return new TPLinkTapoDriver({
      email: c.email,
      password: c.password,
      hosts: c.hosts
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
  },
};
