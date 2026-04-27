/**
 * @fileoverview Единая точка навигации к пульту колонки.
 *
 * Логика `openSpeaker`:
 *  1. Device-запись для активной станции есть → push `/devices/<id>`.
 *  2. Станция подключена, Device отсутствует → `syncYandexHome`, retry поиск.
 *     Если по-прежнему нет — info-toast и push `/alice`.
 *  3. Станция не подключена → push `/alice` (OAuth / setup).
 */

import { useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useToasterStore } from '@/stores/toaster';

interface OpenSpeakerOptions {
  /**
   * При `true` (default) — запускает `syncYandexHome` если Device не найден,
   * затем повторяет поиск. `false` — без sync'а, для background-callsite'ов.
   */
  autoSync?: boolean;
}

export interface SpeakerNavigation {
  /** Пытается открыть пульт колонки. Возвращает true если удалось. */
  openSpeaker(options?: OpenSpeakerOptions): Promise<boolean>;
  /**
   * Ищет Device-запись для подключённой колонки. Возвращает id Device или null.
   * Не делает sync — синхронный вызов.
   */
  findSpeakerDeviceId(): string | null;
}

export function useSpeakerNavigation(): SpeakerNavigation {
  const router = useRouter();
  const devices = useDevicesStore();
  const station = useYandexStationStore();
  const toaster = useToasterStore();

  function findSpeakerDeviceId(): string | null {
    const stationDeviceId = station.status?.station?.deviceId;
    if (!stationDeviceId) return null;
    // Match key — `meta.quasarDeviceId` (== glagol mDNS `deviceId`).
    // `Device.externalId` хранит quasar UUID и не совпадает с mDNS id.
    const list = devices.devices.filter((d) => d.driver === 'yandex-iot');
    const byQuasarId = list.find((d) => d.meta?.['quasarDeviceId'] === stationDeviceId);
    if (byQuasarId) return byQuasarId.id;
    // Legacy snapshot без `quasar_info` — match по `externalId`.
    const byExt = list.find((d) => d.externalId === stationDeviceId);
    if (byExt) return byExt.id;
    // Fallback: единственная yandex-iot media-station без `quasarDeviceId`.
    const speakers = list.filter(
      (d) => d.type.startsWith('devices.types.media_device') && !d.meta?.['quasarDeviceId'],
    );
    if (speakers.length === 1) return speakers[0]!.id;
    return null;
  }

  async function openSpeaker(options: OpenSpeakerOptions = {}): Promise<boolean> {
    const { autoSync = true } = options;

    // Fast path: Device-запись есть в реестре.
    const direct = findSpeakerDeviceId();
    if (direct) {
      await router.push({ name: 'device', params: { id: direct } });
      return true;
    }

    // Станция не подключена — onboarding.
    if (station.status?.connection !== 'connected') {
      await router.push('/alice');
      return false;
    }

    // Glagol-канал активен, Device отсутствует — silent sync + retry поиск.
    if (autoSync) {
      try {
        await devices.syncYandexHome({ silent: true });
      } catch {
        /* единое сообщение ниже */
      }
      const after = findSpeakerDeviceId();
      if (after) {
        await router.push({ name: 'device', params: { id: after } });
        return true;
      }
    }

    // Glagol активен (WS :1961), но iot.quasar не вернул колонку в snapshot'е.
    // Контракт Quasar API: колонка появляется в `households[].all[]` только
    // после регистрации в приложении «Дом с Алисой».
    toaster.push({
      kind: 'info',
      message: 'Колонка работает локально, но не в «Доме с Алисой»',
      detail:
        'Локальный канал (WebSocket :1961) уже подключён. Полный пульт через хаб появится, когда колонка будет в вашем «Доме с Алисой» — добавьте её в приложении «Дом с Алисой» от Яндекса, затем синхронизируйте.',
    });
    if (router.currentRoute.value.path !== '/alice') {
      await router.push('/alice');
    }
    return false;
  }

  return { openSpeaker, findSpeakerDeviceId };
}
