import type { DriverModule } from '../driver-module.js';
import { SwitchBotDriver } from './switchbot-driver.js';
import { probeViaDiscover } from '../_shared/probe-via-discover.js';

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
      {
        key: '__register',
        kind: 'register-link',
        label: 'Как получить Token и Secret',
        hint: 'SwitchBot app → Profile → Preferences → тапните 10 раз по «App Version». Появится «Developer Options» — там Token + Client Secret.',
        url: 'https://github.com/OpenWonderLabs/SwitchBotAPI#getting-started',
      },
      {
        key: 'token',
        label: 'Token',
        kind: 'password',
        required: true,
        hint: 'Длинный hex-токен из Developer Options.',
      },
      {
        key: 'secret',
        label: 'Client Secret',
        kind: 'password',
        required: true,
        hint: 'Используется для HMAC-подписи запросов (v1.1 API).',
      },
      { key: '__test', kind: 'test-button', label: 'Проверить' },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('switchbot') as { token?: string; secret?: string };
    if (!c.token || !c.secret) return null;
    return new SwitchBotDriver(c.token, c.secret);
  },
  async probe(values) {
    if (!values['token'] || !values['secret']) {
      return { ok: false, message: 'Введите Token и Client Secret' };
    }
    return probeViaDiscover(async () => new SwitchBotDriver(values['token']!, values['secret']!));
  },
};
