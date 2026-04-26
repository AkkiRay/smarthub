import type { DriverModule } from '../driver-module.js';
import { SwitchBotDriver } from './switchbot-driver.js';

export const switchbotModule: DriverModule = {
  descriptor: {
    id: 'switchbot',
    displayName: 'SwitchBot',
    description: 'SwitchBot Cloud API: Bot, Plug Mini, Curtain, Bulb, Hub Mini.',
    category: 'cloud-global',
    region: 'global',
    brandColor: '#69D2E7',
    requiresCredentials: true,
    supportedTypes: ['light', 'socket', 'sensor', 'openable.curtain', 'humidifier', 'lock'],
    maturity: 'beta',
    docsUrl: 'https://github.com/OpenWonderLabs/SwitchBotAPI',
    credentialsSchema: [
      { key: 'token', label: 'Token', kind: 'password', required: true },
      { key: 'secret', label: 'Secret', kind: 'password', required: true },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('switchbot') as { token?: string; secret?: string };
    if (!c.token || !c.secret) return null;
    return new SwitchBotDriver(c.token, c.secret);
  },
};
