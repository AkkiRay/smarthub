import type { DriverModule } from '../driver-module.js';
import { HomeAssistantDriver } from './home-assistant-driver.js';
import { probeViaDiscover } from '../_shared/probe-via-discover.js';

export const homeAssistantModule: DriverModule = {
  descriptor: {
    id: 'home-assistant',
    displayName: 'Home Assistant',
    description: 'Bridge к Home Assistant — закрывает все интеграции HA одним аккаунтом.',
    category: 'bridge',
    region: 'global',
    brandColor: '#41BDF5',
    requiresCredentials: true,
    supportedTypes: [
      'light',
      'socket',
      'switch',
      'sensor',
      'thermostat',
      'fan',
      'media_device',
      'lock',
      'camera',
      'vacuum_cleaner',
      'openable.curtain',
    ],
    maturity: 'stable',
    docsUrl: 'https://developers.home-assistant.io/docs/api/rest/',
    credentialsSchema: [
      {
        key: '__register',
        kind: 'register-link',
        label: 'Создать Long-Lived Access Token',
        hint: 'В вашем Home Assistant: Profile → Security → Long-Lived Access Tokens → Create Token. URL — тот же адрес, по которому вы открываете HA в браузере.',
        url: 'https://www.home-assistant.io/integrations/auth/',
      },
      {
        key: 'url',
        label: 'URL Home Assistant',
        kind: 'text',
        placeholder: 'http://homeassistant.local:8123',
        required: true,
      },
      {
        key: 'token',
        label: 'Long-Lived Access Token',
        kind: 'password',
        hint: 'Профиль HA → Security → Long-Lived Access Tokens.',
        required: true,
      },
      { key: '__test', kind: 'test-button', label: 'Проверить' },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('home-assistant') as { url?: string; token?: string };
    if (!c.url || !c.token) return null;
    return new HomeAssistantDriver({ url: c.url, token: c.token });
  },
  async probe(values) {
    if (!values['url'] || !values['token']) {
      return { ok: false, message: 'Заполните URL и токен' };
    }
    return probeViaDiscover(
      async () => new HomeAssistantDriver({ url: values['url']!, token: values['token']! }),
    );
  },
};
