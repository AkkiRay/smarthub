import type { DriverModule } from '../driver-module.js';
import { HomeAssistantDriver } from './home-assistant-driver.js';

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
        key: 'url',
        label: 'URL Home Assistant',
        kind: 'text',
        placeholder: 'http://homeassistant.local:8123',
        required: true,
      },
      {
        key: 'token',
        label: 'Long-lived access token',
        kind: 'password',
        hint: 'Профиль HA → Security → Long-Lived Access Tokens.',
        required: true,
      },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('home-assistant') as { url?: string; token?: string };
    if (!c.url || !c.token) return null;
    return new HomeAssistantDriver({ url: c.url, token: c.token });
  },
};
