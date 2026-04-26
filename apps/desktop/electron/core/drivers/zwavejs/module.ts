import type { DriverModule } from '../driver-module.js';
import { ZWaveJsDriver } from './zwavejs-driver.js';

export const zwavejsModule: DriverModule = {
  descriptor: {
    id: 'zwavejs',
    displayName: 'Z-Wave-JS',
    description: 'Z-Wave-JS WebSocket bridge — закрывает все Z-Wave устройства через zwave-js-ui.',
    category: 'bridge',
    region: 'global',
    brandColor: '#005C97',
    requiresCredentials: true,
    supportedTypes: ['light', 'socket', 'sensor', 'thermostat', 'lock'],
    maturity: 'beta',
    docsUrl: 'https://zwave-js.github.io/zwave-js-server/',
    credentialsSchema: [
      {
        key: 'url',
        label: 'WebSocket URL',
        kind: 'text',
        placeholder: 'ws://192.168.1.5:3000',
        required: true,
      },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('zwavejs') as { url?: string };
    if (!c.url) return null;
    return new ZWaveJsDriver({ url: c.url });
  },
};
