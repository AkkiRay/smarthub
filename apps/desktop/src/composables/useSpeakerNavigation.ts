/**
 * Единая точка навигации к пульту колонки. Любая ссылка / кнопка «Открыть колонку»
 * в UI идёт через этот composable — иначе мы плодим три разных способа найти
 * speaker-Device, каждый со своими краевыми случаями и багами.
 *
 * Логика:
 *   1. Если Я.Станция подключена ПО WS и совпадает с Device в реестре → push на
 *      `/devices/<id>` (там SpeakerControlSurface).
 *   2. Если станция подключена, но Device-записи нет (юзер не сделал sync ИЛИ
 *      iot.quasar не вернул её в households[].all[]) → попробовать sync, потом
 *      снова искать. Если опять нет — toast «не найдено» + push на /devices.
 *   3. Если станция не подключена вовсе → push на /alice (там OAuth/setup).
 *
 * Замена для прямого `router.push('/speaker')` в AliceView/Sidebar/DeviceDetail —
 * `/speaker` route остаётся как legacy redirect, но новый код использует это.
 */

import { useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useToasterStore } from '@/stores/toaster';

interface OpenSpeakerOptions {
  /**
   * Если true (default) — при отсутствии Device запустит `syncYandexHome` и
   * попробует снова. Disable чтобы избежать каскадных sync'ов из background-кнопок.
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
    const found = devices.devices.find(
      (d) => d.driver === 'yandex-iot' && d.externalId === stationDeviceId,
    );
    return found?.id ?? null;
  }

  async function openSpeaker(options: OpenSpeakerOptions = {}): Promise<boolean> {
    const { autoSync = true } = options;

    // Быстрый путь: запись уже есть в реестре.
    const direct = findSpeakerDeviceId();
    if (direct) {
      await router.push({ name: 'device', params: { id: direct } });
      return true;
    }

    // Станция не подключена — отправляем на onboarding.
    if (station.status?.connection !== 'connected') {
      await router.push('/alice');
      return false;
    }

    // Станция подключена, но Device-записи нет. Можно попробовать sync.
    if (autoSync) {
      try {
        await devices.syncYandexHome();
      } catch {
        /* toast уже показан внутри syncYandexHome */
      }
      const after = findSpeakerDeviceId();
      if (after) {
        await router.push({ name: 'device', params: { id: after } });
        return true;
      }
    }

    // После sync устройства всё ещё нет — Я.Станция не возвращается в
    // iot.quasar (бывает на новых моделях). Дальше идти некуда: показываем
    // явный feedback + переводим на /devices.
    toaster.push({
      kind: 'info',
      message: 'Колонка не появилась в «Доме с Алисой»',
      detail: 'Возможно, Яндекс ещё не индексировал её. Управление через раздел «Подключение Алисы».',
    });
    await router.push('/devices');
    return false;
  }

  return { openSpeaker, findSpeakerDeviceId };
}
