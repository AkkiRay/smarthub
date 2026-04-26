import type { DriverModule } from '../driver-module.js';
import { MqttDriver } from './mqtt-driver.js';

export const mqttModule: DriverModule = {
  descriptor: {
    id: 'mqtt',
    displayName: 'MQTT',
    description:
      'Универсальный MQTT-брокер: Zigbee2MQTT, ESPHome, Tasmota, Home Assistant discovery.',
    category: 'protocol',
    region: 'global',
    brandColor: '#660066',
    requiresCredentials: true,
    supportedTypes: ['light', 'socket', 'switch', 'sensor'],
    maturity: 'stable',
    docsUrl: 'https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html',
    credentialsSchema: [
      {
        key: 'url',
        label: 'URL брокера',
        kind: 'text',
        placeholder: 'mqtt://192.168.1.10:1883',
        required: true,
      },
      { key: 'username', label: 'Username', kind: 'text' },
      { key: 'password', label: 'Password', kind: 'password' },
      {
        key: 'extraTopicPrefix',
        label: 'Доп. префикс топиков',
        kind: 'text',
        placeholder: 'tasmota / esphome / homeassistant',
        hint: 'Кроме zigbee2mqtt/* подпишемся на этот префикс — для ESPHome и Tasmota.',
      },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('mqtt') as {
      url?: string;
      username?: string;
      password?: string;
      extraTopicPrefix?: string;
    };
    if (!c.url) return null;
    return new MqttDriver({
      url: c.url,
      username: c.username,
      password: c.password,
      extraTopicPrefix: c.extraTopicPrefix,
    });
  },
};
