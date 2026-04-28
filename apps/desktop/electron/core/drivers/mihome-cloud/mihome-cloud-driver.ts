/**
 * @fileoverview
 * Mi Home Cloud / Xiaomi Cloud: REST API через api.io.mi.com/app.
 * Login flow: serviceLogin → captcha → SHA1(password) → location → ssecurity + serviceToken.
 * Reverse-engineered протокол, нет публичного SDK; здесь упрощённый flow без 2FA-handler'а.
 *
 * Server-region URL префикс: 'cn'/'de'/'i2' (India)/'ru'/'sg'/'us'.
 *   ru.api.io.mi.com — для российских аккаунтов (если устройства куплены в РФ).
 *
 * После login API:
 *   POST /home/device_list           → список устройств
 *   POST /home/rpc/<device_id>       → JSON-RPC method calls (как miIO local)
 */

import axios, { type AxiosRequestConfig } from 'axios';
import { createHash, randomBytes } from 'node:crypto';
import type {
  Device,
  DeviceCommand,
  DeviceCommandResult,
  DeviceType,
  DiscoveredDevice,
} from '@smarthome/shared';
import { CAPABILITY, DEVICE_TYPE, INSTANCE, UNIT } from '@smarthome/shared';
import { capMode, capOnOff, propFloat } from '@smarthome/shared';
import { BaseCloudDriver } from '../_shared/base-cloud-driver.js';
import { decodeUtf8, extractCookie, parseMiJson, type MiSession } from './mihome-utils.js';

/**
 * Creds может быть либо «классическим» password-flow (только для аккаунтов без
 * 2FA), либо pre-fetched session из embedded OAuth-окна (`runMihomeOauth`).
 * Session — единственный способ для аккаунтов с email/SMS-2FA.
 */
export interface MiHomeCloudCreds {
  username?: string;
  password?: string;
  /** Pre-acquired session: ssecurity / userId / serviceToken из OAuth flow. */
  session?: MiSession;
  region?: 'cn' | 'de' | 'i2' | 'ru' | 'sg' | 'us';
}

interface MiCloudDevice {
  did: string;
  token: string;
  name: string;
  model: string;
  isOnline: boolean;
  localip: string;
}

export class MiHomeCloudDriver extends BaseCloudDriver {
  readonly id = 'mihome-cloud' as const;
  readonly displayName = 'Mi Home Cloud';

  private session: MiSession | null = null;
  private readonly region: string;
  /** Username присутствует только для password-flow (без 2FA). При session-flow undefined. */
  private readonly username: string | undefined;
  /**
   * Mi Cloud login принимает MD5(password).hex.upperCase как `hash` параметр —
   * сам plaintext password ему не нужен. Считаем хэш ОДИН раз в конструкторе и
   * не держим plaintext password в памяти весь lifetime приложения. Heap-dump
   * (crash) больше не утечёт пароль; raw уже undefined в this.
   * Undefined при session-flow.
   */
  private readonly passwordHash: string | undefined;
  /**
   * Стабильный per-install deviceId — имитация Mi Home Android-SDK.
   * Без этой cookie login отвергается с code 70016: сервер сам ставит web-fallback
   * `deviceId=wb_<uuid>` и отказывает в auth. 16-hex как в Mi Home APK.
   */
  private readonly deviceId: string = randomBytes(8).toString('hex');

  constructor(creds: MiHomeCloudCreds) {
    super({
      baseURL: `https://${creds.region ?? 'cn'}.api.io.mi.com/app`,
      timeoutMs: 8000,
      defaultHeaders: {
        // Mi Home 2026: Android 14, app v9.x. Старый UA (Android-7.1.1) Xiaomi
        // anti-bot уже блокирует с конца 2024 (login возвращает code -7).
        'User-Agent':
          'Android-14-9.6.108-com.xiaomi.smarthome-AndroidApp APP/com.xiaomi.smarthome APPV/9.6.108',
        'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    this.region = creds.region ?? 'cn';
    this.username = creds.username;
    this.passwordHash = creds.password
      ? createHash('md5').update(creds.password).digest('hex').toUpperCase()
      : undefined;
    // Pre-fetched session из embedded OAuth — driver сразу готов к API-call'ам,
    // ensureSession() короткозамыкает на её возврат.
    if (creds.session) this.session = creds.session;
  }

  protected applyAuth(config: AxiosRequestConfig): AxiosRequestConfig {
    if (this.session) {
      // Полный набор cookies для api.io.mi.com per
      // https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor.
      // `yetAnotherServiceToken` обязателен — без него API возвращает 401
      // (это не тайпо: Xiaomi реально дублирует serviceToken под этим именем).
      const cookies = [
        `userId=${this.session.userId}`,
        `serviceToken=${this.session.serviceToken}`,
        `yetAnotherServiceToken=${this.session.serviceToken}`,
        'locale=en_GB',
        'timezone=GMT+02:00',
        'is_daylight=1',
        'dst_offset=3600000',
        'channel=MI_APP_STORE',
      ].join('; ');
      config.headers = {
        ...(config.headers as Record<string, unknown>),
        Cookie: cookies,
      };
    }
    return config;
  }

  protected async refreshToken(): Promise<void> {
    // Сначала пробуем silent re-auth через embedded partition (passToken cookie
    // живёт ~1 год, ssecurity/serviceToken протухают чаще). Если получилось —
    // session обновлена, retry на API будет успешен. Если passToken тоже
    // истёк — fallback на password-flow для legacy creds; в session-only
    // режиме ensureSession() бросит «откройте Настройки и войдите заново».
    const { resilverSessionFromPartition } = await import('../../../main/oauth/mihome-oauth.js');
    const fresh = await resilverSessionFromPartition();
    if (fresh) {
      this.session = fresh;
      return;
    }
    this.session = null;
    await this.ensureSession();
  }

  async discover(_signal: AbortSignal): Promise<DiscoveredDevice[]> {
    // Не swallow'им ошибки: login-fail и сетевые сбои всплывают наверх.
    // probeViaDiscover (UI «Проверить») получит реальный message,
    // discovery-service делает allSettled и помечает phase=error в progress UI —
    // юзер видит «Mi Home (Cloud): error» вместо ложного «Найдено 0 устройств».
    const result = await this.callApi<{ result: { list: MiCloudDevice[] } }>('/home/device_list', {
      getVirtualModel: false,
      getHuamiDevices: 0,
    });
    return result.result.list.map((d) => ({
      driver: 'mihome-cloud' as const,
      externalId: d.did,
      type: inferType(d.model),
      name: d.name,
      address: d.localip || 'cloud',
      meta: { token: d.token, model: d.model, isOnline: d.isOnline, did: d.did },
    }));
  }

  async probe(candidate: DiscoveredDevice): Promise<Device | null> {
    const now = new Date().toISOString();
    const meta = candidate.meta as { model?: string };
    const model = meta.model ?? '';
    const isVacuum = candidate.type === DEVICE_TYPE.VACUUM;

    // Vacuum: on_off (start/dock) + work_speed (fan power) + water_level + battery property.
    // Лампы и прочее: minimum on_off (старое поведение).
    const capabilities = isVacuum
      ? [
          capOnOff(false),
          capMode(INSTANCE.WORK_SPEED, ['quiet', 'normal', 'turbo', 'max'], 'normal'),
          capMode(INSTANCE.WATER_LEVEL, ['low', 'normal', 'high'], 'normal'),
        ]
      : [capOnOff(false)];

    const properties = isVacuum
      ? [
          propFloat(INSTANCE.BATTERY_LEVEL, 0, UNIT.PERCENT),
          propFloat('clean_time', 0),
          propFloat('clean_area', 0),
        ]
      : [];

    return {
      id: '',
      externalId: candidate.externalId,
      driver: 'mihome-cloud',
      type: candidate.type,
      name: candidate.name,
      address: candidate.address,
      hidden: false,
      meta: { ...meta, model, isVacuum },
      status: 'online',
      capabilities,
      properties,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  async readState(device: Device): Promise<Device> {
    try {
      const meta = device.meta as { did: string; model: string; isVacuum?: boolean };
      const isVacuum = meta.isVacuum ?? device.type === DEVICE_TYPE.VACUUM;

      if (isVacuum) {
        const metaWithRegion = meta as {
          did: string;
          model: string;
          isVacuum?: boolean;
          apiRegion?: string;
          miotProtocol?: boolean;
        };
        const tryRegion = metaWithRegion.apiRegion;
        const isMiot = metaWithRegion.miotProtocol === true;
        let status: VacuumStatusRaw | null = null;
        let workingRegion: string | undefined = tryRegion;

        // Если уже знаем что device — MiOT, пропускаем все legacy probe-попытки
        // и идём прямо в MiOT-блок (sticky protocol).
        if (!isMiot) {
          const r = await this.callApi<{ result: unknown; code?: number; message?: string }>(
            `/home/rpc/${meta.did}`,
            { method: 'get_status', params: [] },
            tryRegion,
          );

          // Mi Cloud miIO endpoint часто отдаёт code !== 0 при device sleeping —
          // логируем конкретно, чтобы UI debugger видел причину вместо silent unreachable.
          if (typeof r?.code === 'number' && r.code !== 0) {
            this.logWarn(
              `vacuum get_status code=${r.code} message=${r.message ?? '-'} (did=${meta.did})`,
            );
          }
          const arr = Array.isArray(r?.result) ? (r.result as unknown[]) : [];
          status = (arr[0] && typeof arr[0] === 'object' ? arr[0] : null) as VacuumStatusRaw | null;

          // Auto-region probe: result=[] обычно значит что device привязан к
          // другому Mi Cloud региону (cross-region listing работает, RPC — нет).
          if (!status) {
            this.logWarn(
              `vacuum ${meta.did}: get_status empty (region=${tryRegion ?? this.region}), probing all regions`,
            );
            const candidates = MiHomeCloudDriver.ALL_REGIONS.filter(
              (r0) => r0 !== (tryRegion ?? this.region),
            );
            for (const probe of candidates) {
              try {
                const rp = await this.callApi<{ result: unknown }>(
                  `/home/rpc/${meta.did}`,
                  { method: 'get_status', params: [] },
                  probe,
                );
                const arrp = Array.isArray(rp?.result) ? (rp.result as unknown[]) : [];
                const cand = (
                  arrp[0] && typeof arrp[0] === 'object' ? arrp[0] : null
                ) as VacuumStatusRaw | null;
                if (cand) {
                  status = cand;
                  workingRegion = probe;
                  this.logInfo(`vacuum ${meta.did}: found in region=${probe}, caching`);
                  break;
                }
              } catch (ep) {
                this.logWarn(`vacuum ${meta.did}: region=${probe} probe failed`, ep);
              }
            }
          }
        }

        // MiOT-spec: либо isMiot==true (sticky), либо legacy не нашёл status.
        // siid/piid/aiid per-model — resolveVacuumSpec(model). Опциональные
        // properties (cleaningTime/cleaningArea/waterFlow) запрашиваются если
        // spec их объявляет (mc1808 без water-flow, F9-family с ним).
        if (!status) {
          const spec = resolveVacuumSpec(meta.model ?? '');
          if (!isMiot) {
            this.logWarn(
              `vacuum ${meta.did} model=${meta.model}: trying MiOT-spec (status@${spec.status.siid}/${spec.status.piid}, battery@${spec.battery.siid}/${spec.battery.piid}, fan@${spec.fanMode.siid}/${spec.fanMode.piid})`,
            );
          }
          try {
            const reqProps: Array<{ did: string; siid: number; piid: number }> = [
              { did: meta.did, siid: spec.status.siid, piid: spec.status.piid },
              { did: meta.did, siid: spec.battery.siid, piid: spec.battery.piid },
              { did: meta.did, siid: spec.fanMode.siid, piid: spec.fanMode.piid },
            ];
            if (spec.cleaningTime) reqProps.push({ did: meta.did, ...spec.cleaningTime });
            if (spec.cleaningArea) reqProps.push({ did: meta.did, ...spec.cleaningArea });
            if (spec.waterFlow) reqProps.push({ did: meta.did, ...spec.waterFlow });

            const r3 = await this.callApi<{
              result: Array<{ siid: number; piid: number; code: number; value: unknown }>;
            }>('/miotspec/prop/get', { params: reqProps }, workingRegion);
            const props = Array.isArray(r3?.result) ? r3.result : [];
            const find = (siid: number, piid: number): unknown =>
              props.find((p) => p.siid === siid && p.piid === piid && p.code === 0)?.value;

            const miotStatusRaw = Number(find(spec.status.siid, spec.status.piid) ?? -1);
            const miotBattery = Number(find(spec.battery.siid, spec.battery.piid) ?? -1);
            const miotMode = Number(find(spec.fanMode.siid, spec.fanMode.piid) ?? -1);
            const miotCleanTime = spec.cleaningTime
              ? Number(find(spec.cleaningTime.siid, spec.cleaningTime.piid) ?? 0)
              : 0;
            const miotCleanArea = spec.cleaningArea
              ? Number(find(spec.cleaningArea.siid, spec.cleaningArea.piid) ?? 0)
              : 0;
            const miotWaterFlow = spec.waterFlow
              ? Number(find(spec.waterFlow.siid, spec.waterFlow.piid) ?? -1)
              : -1;

            if (miotBattery >= 0 || miotStatusRaw >= 0) {
              const mappedState = spec.statusMap[miotStatusRaw] ?? miotStatusRaw;
              // cleaning_time у Dreame отдаётся в МИНУТАХ (не секундах), так что *60 для совместимости с downstream / 60 mapping'ом.
              // cleaning_area у Dreame в м² (не мм²), так что *1_000_000 чтобы downstream / 1_000_000 mapping вернул правильно.
              status = {
                state: mappedState,
                battery: miotBattery >= 0 ? miotBattery : 0,
                fan_power: spec.fanFromRaw(Math.max(0, miotMode)),
                // 0 → low, 1 → normal, 2 → high (Dreame/F9 water_flow scale).
                water_box_mode: miotWaterFlow >= 0 ? 200 + Math.min(2, miotWaterFlow) : 201,
                clean_time: miotCleanTime * 60,
                clean_area: miotCleanArea * 1_000_000,
                in_cleaning: mappedState === 5 ? 1 : 0,
                error_code: mappedState === 12 ? 1 : 0,
              };
              metaWithRegion.apiRegion = workingRegion ?? this.region;
              metaWithRegion.miotProtocol = true;
              this.logInfo(
                `vacuum ${meta.did}: MiOT-spec OK (status=${miotStatusRaw}→${mappedState}, battery=${miotBattery}, mode=${miotMode}, time=${miotCleanTime}min, area=${miotCleanArea}m²)`,
              );
            }
          } catch (e3) {
            this.logWarn(`vacuum ${meta.did}: MiOT-spec failed`, e3);
          }
        }

        // Final fallback: legacy get_prop для старых прошивок Mi Robot 1S / viomi.
        if (!status) {
          this.logWarn(`vacuum ${meta.did}: MiOT empty, trying legacy get_prop fallback`);
          try {
            const r2 = await this.callApi<{ result: unknown[] }>(
              `/home/rpc/${meta.did}`,
              {
                method: 'get_prop',
                params: [
                  'run_state',
                  'battary_life',
                  's_time',
                  's_area',
                  'suction_grade',
                  'water_grade',
                ],
              },
              workingRegion,
            );
            const arr2 = Array.isArray(r2?.result) ? r2.result : [];
            if (arr2.length >= 4) {
              status = {
                state: Number(arr2[0]) || 0,
                battery: Number(arr2[1]) || 0,
                clean_time: Number(arr2[2]) || 0,
                clean_area: Number(arr2[3]) || 0,
                fan_power: Number(arr2[4]) || 102,
                water_box_mode: Number(arr2[5]) || 201,
                in_cleaning: 0,
                error_code: 0,
              };
            }
          } catch (e2) {
            this.logWarn(`vacuum ${meta.did}: get_prop fallback failed`, e2);
          }
        }
        if (!status) return { ...device, status: 'unreachable' };

        // state-codes 5/6/7/11/15/16/17/18 → cleaning-like (on=true).
        // 8 (charging), 100 (fully charged), 3 (idle), 10 (paused), 2 (sleeping) → on=false.
        const cleaningStates = new Set([5, 6, 7, 11, 15, 16, 17, 18]);
        const isOn = cleaningStates.has(Number(status.state));

        const fanMode = fanPowerToMode(Number(status.fan_power));
        const waterMode = waterBoxModeToMode(Number(status.water_box_mode));

        return {
          ...device,
          status: 'online',
          lastSeenAt: new Date().toISOString(),
          capabilities: device.capabilities.map((c) => {
            if (c.type === CAPABILITY.ON_OFF) {
              return { ...c, state: { instance: INSTANCE.ON, value: isOn } };
            }
            if (c.type === CAPABILITY.MODE && c.parameters?.['instance'] === INSTANCE.WORK_SPEED) {
              return { ...c, state: { instance: INSTANCE.WORK_SPEED, value: fanMode } };
            }
            if (c.type === CAPABILITY.MODE && c.parameters?.['instance'] === INSTANCE.WATER_LEVEL) {
              return { ...c, state: { instance: INSTANCE.WATER_LEVEL, value: waterMode } };
            }
            return c;
          }),
          properties: device.properties.map((p) => {
            if (p.parameters.instance === INSTANCE.BATTERY_LEVEL) {
              return {
                ...p,
                state: { instance: INSTANCE.BATTERY_LEVEL, value: Number(status.battery) || 0 },
              };
            }
            if (p.parameters.instance === 'clean_time') {
              return {
                ...p,
                state: {
                  instance: 'clean_time',
                  value: Math.round(Number(status.clean_time) / 60),
                },
              };
            }
            if (p.parameters.instance === 'clean_area') {
              return {
                ...p,
                state: {
                  instance: 'clean_area',
                  value: Math.round((Number(status.clean_area) / 1_000_000) * 100) / 100,
                },
              };
            }
            return p;
          }),
          meta: {
            ...meta,
            lastStatus: status,
            ...(workingRegion ? { apiRegion: workingRegion } : {}),
          },
        };
      }

      // Lamp-flow (legacy default).
      const r = await this.callApi<{ result: unknown[] }>(`/home/rpc/${meta.did}`, {
        method: 'get_prop',
        params: ['power', 'bright', 'rgb', 'ct'],
      });
      const arr = Array.isArray(r.result) ? r.result : [];
      const [power, bright, rgb] = arr as [string, number, number];
      return {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        capabilities: device.capabilities.map((c) => {
          if (c.type === CAPABILITY.ON_OFF) {
            return { ...c, state: { instance: INSTANCE.ON, value: power === 'on' } };
          }
          if (c.type === CAPABILITY.RANGE && c.state?.instance === INSTANCE.BRIGHTNESS) {
            return { ...c, state: { instance: INSTANCE.BRIGHTNESS, value: bright || 100 } };
          }
          if (c.type === CAPABILITY.COLOR_SETTING) {
            return { ...c, state: { instance: INSTANCE.RGB, value: rgb || 0xffffff } };
          }
          return c;
        }),
      };
    } catch (e) {
      this.logWarn(
        `readState failed for ${device.id} (${(device.meta as Record<string, unknown>)?.['did'] ?? '-'})`,
        e,
      );
      return { ...device, status: 'unreachable' };
    }
  }

  async execute(device: Device, command: DeviceCommand): Promise<DeviceCommandResult> {
    const meta = device.meta as {
      did: string;
      model?: string;
      isVacuum?: boolean;
      apiRegion?: string;
      miotProtocol?: boolean;
    };
    const isVacuum = meta.isVacuum ?? device.type === DEVICE_TYPE.VACUUM;
    let payload: { method: string; params: unknown[] } | null = null;

    // MiOT-spec ветка: для современных пылесосов команды через /miotspec/action +
    // /miotspec/prop/set с PER-MODEL siid/aiid. Roborock spec ≠ Dreame spec —
    // mirror'ить чужой = «ON отправляет на док» (как было до этого фикса).
    if (isVacuum && meta.miotProtocol) {
      const spec = resolveVacuumSpec(meta.model ?? '');
      try {
        if (command.capability === CAPABILITY.ON_OFF) {
          const action = command.value ? spec.startAction : spec.dockAction;
          await this.callApi(
            '/miotspec/action',
            {
              params: { did: meta.did, siid: action.siid, aiid: action.aiid, in: [] },
            },
            meta.apiRegion,
          );
        } else if (
          command.capability === CAPABILITY.MODE &&
          command.instance === INSTANCE.WORK_SPEED
        ) {
          const fan = modeToFanPower(String(command.value));
          if (fan === null) return this.err(device, command, 'UNSUPPORTED_VALUE');
          await this.callApi(
            '/miotspec/prop/set',
            {
              params: [
                {
                  did: meta.did,
                  siid: spec.fanMode.siid,
                  piid: spec.fanMode.piid,
                  value: spec.fanToRaw(fan),
                },
              ],
            },
            meta.apiRegion,
          );
        } else if (
          command.capability === CAPABILITY.MODE &&
          command.instance === INSTANCE.WATER_LEVEL
        ) {
          // Многие MiOT vacuum'ы не имеют water_level через MiOT — silent OK.
          this.logWarn(`vacuum ${meta.did}: water_level not exposed via MiOT-spec, skipping`);
        } else {
          return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
        }
        return this.ok(device, command.capability, command.instance);
      } catch (e) {
        return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
      }
    }

    if (isVacuum) {
      // on_off: true = start cleaning (app_start), false = return to dock (app_charge).
      // work_speed → set_custom_mode([fan_power 101..104]).
      // water_level → set_water_box_custom_mode([200..202]).
      if (command.capability === CAPABILITY.ON_OFF) {
        payload = { method: command.value ? 'app_start' : 'app_charge', params: [] };
      } else if (
        command.capability === CAPABILITY.MODE &&
        command.instance === INSTANCE.WORK_SPEED
      ) {
        const fan = modeToFanPower(String(command.value));
        if (fan === null) return this.err(device, command, 'UNSUPPORTED_VALUE');
        payload = { method: 'set_custom_mode', params: [fan] };
      } else if (
        command.capability === CAPABILITY.MODE &&
        command.instance === INSTANCE.WATER_LEVEL
      ) {
        const water = modeToWaterBox(String(command.value));
        if (water === null) return this.err(device, command, 'UNSUPPORTED_VALUE');
        payload = { method: 'set_water_box_custom_mode', params: [water] };
      } else {
        return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
      }
    } else if (command.capability === CAPABILITY.ON_OFF) {
      payload = { method: 'set_power', params: [command.value ? 'on' : 'off'] };
    } else if (
      command.capability === CAPABILITY.RANGE &&
      command.instance === INSTANCE.BRIGHTNESS
    ) {
      payload = {
        method: 'set_bright',
        params: [Math.max(1, Math.min(100, Number(command.value)))],
      };
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.RGB
    ) {
      payload = { method: 'set_rgb', params: [Number(command.value)] };
    } else if (
      command.capability === CAPABILITY.COLOR_SETTING &&
      command.instance === INSTANCE.TEMPERATURE_K
    ) {
      payload = {
        method: 'set_ct_abx',
        params: [Math.max(1700, Math.min(6500, Number(command.value)))],
      };
    } else {
      return this.err(device, command, 'UNSUPPORTED_CAPABILITY');
    }

    try {
      // Используем cached apiRegion для команд (если ранее readState нашёл устройство в другом регионе).
      await this.callApi(`/home/rpc/${meta.did}`, payload, meta.apiRegion);
      return this.ok(device, command.capability, command.instance);
    } catch (e) {
      return this.err(device, command, 'DEVICE_UNREACHABLE', (e as Error).message);
    }
  }

  override async shutdown(): Promise<void> {
    this.session = null;
  }

  /**
   * Список Mi Cloud регионов для auto-detect когда device-region отличается
   * от выбранного юзером (cross-region device_list работает, RPC — нет).
   * Порядок повторяет PiotrMachowski/Xiaomi-cloud-tokens-extractor.
   */
  private static readonly ALL_REGIONS: ReadonlyArray<'cn' | 'de' | 'us' | 'ru' | 'sg' | 'i2'> = [
    'cn',
    'de',
    'us',
    'ru',
    'sg',
    'i2',
  ];

  /**
   * RC4-encrypted API call для api.io.mi.com — единственный рабочий формат
   * Mi Cloud (non-encrypted endpoint возвращает 401). Реализация повторяет
   * `execute_api_call_encrypted` из PiotrMachowski/Xiaomi-cloud-tokens-extractor:
   *
   *   1. params = { data: JSON.stringify(body) }
   *   2. params.rc4_hash__ = SHA1-base64(POST + path-без-/app/ + sorted k=v + signed_nonce)
   *   3. RC4-зашифровать каждое значение в params (с warmup на 1024 нулевых байт)
   *   4. params.signature = SHA1-base64 от шифрованных params (тот же путь что в #2)
   *   5. params.ssecurity = ssecurity (plain), params._nonce = nonce (plain)
   *   6. POST с params как query string (body пустой), header MIOT-ENCRYPT-ALGORITHM
   *   7. Response — base64(rc4(json)); decrypt тем же signed_nonce
   */
  private async callApi<T = unknown>(path: string, body: object, region?: string): Promise<T> {
    const session = await this.ensureSession();

    // nonce = 8 random bytes + 4-byte big-endian (millis / 60000) — формат Mi Cloud.
    const minutes = Math.floor(Date.now() / 60_000);
    const minutesBuf = Buffer.alloc(4);
    minutesBuf.writeUInt32BE(minutes, 0);
    const nonce = Buffer.concat([randomBytes(8), minutesBuf]).toString('base64');
    const signedNonce = signNonce(session.ssecurity, nonce);

    // path для signature — БЕЗ `/app/` префикса (для enc-mode):
    // Python делает `url.split("com")[1].replace("/app/", "/")` →
    // `/app/home/device_list` → `/home/device_list`.
    const signaturePath = path; // у нас path уже без `/app/` (baseURL содержит /app)

    const params: Record<string, string> = { data: JSON.stringify(body) };
    // Step 1: rc4_hash__ от plaintext params
    params['rc4_hash__'] = generateEncSignature(signaturePath, 'POST', signedNonce, params);
    // Step 2: encrypt все values RC4 + base64 (с warmup 1024 нулевых байт — Xiaomi-spec)
    for (const k of Object.keys(params)) {
      const v = params[k];
      if (v === undefined) continue;
      params[k] = rc4WithWarmup(signedNonce, Buffer.from(v, 'utf8')).toString('base64');
    }
    // Step 3: signature от encrypted params + ssecurity + _nonce (plaintext)
    const finalParams: Record<string, string> = {
      ...params,
      signature: generateEncSignature(signaturePath, 'POST', signedNonce, params),
      ssecurity: session.ssecurity,
      _nonce: nonce,
    };

    // Body пустой — все параметры в query string (Python `requests.post(url, params=fields)`).
    // responseType=text — тело encrypted, JSON.parse делаем после decrypt.
    // region override: для cross-region devices (когда устройство привязано к
    // другому регионалу Mi Cloud) дёргаем absolute URL вместо baseURL.
    const requestConfig: AxiosRequestConfig = {
      method: 'POST',
      url: region && region !== this.region ? `https://${region}.api.io.mi.com/app${path}` : path,
      params: finalParams,
      headers: {
        'MIOT-ENCRYPT-ALGORITHM': 'ENCRYPT-RC4',
        'Accept-Encoding': 'identity',
      },
      responseType: 'text',
      transformResponse: [(d: string) => d],
    };
    const encryptedBody = await this.request<string>(requestConfig);

    const decryptedJson = rc4WithWarmup(signedNonce, Buffer.from(encryptedBody, 'base64')).toString(
      'utf8',
    );
    return JSON.parse(decryptedJson) as T;
  }

  private async ensureSession(): Promise<MiSession> {
    if (this.session) return this.session;

    // Без password-flow login невозможен (session-only driver — re-auth требует
    // повторного открытия embedded BrowserWindow в renderer'е).
    if (!this.username || !this.passwordHash) {
      throw new Error(
        'Mi Cloud: сессия истекла. Откройте «Настройки → Интеграции → Mi Home (Cloud)» и войдите заново.',
      );
    }

    // Cookie jar с preset-значениями имитирует Mi Home Android-SDK.
    // sdkVersion + deviceId обязательны: без них Xiaomi pass возвращает 70016
    // (сервер ставит web-fallback `deviceId=wb_<uuid>` и блокирует login).
    const jar = new Map<string, string>();
    jar.set('sdkVersion', 'accountsdk-18.8.15');
    jar.set('deviceId', this.deviceId);

    // Step 1: получить _sign из serviceLogin redirect.
    // arraybuffer + manual UTF-8 decode — `responseEncoding: 'utf8'` axios http-adapter
    // игнорирует, response с китайским `desc` приходит latin1 → mojibake (CP866 при rendering).
    const step1 = await axios.get<ArrayBuffer>(
      'https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true',
      {
        responseType: 'arraybuffer',
        maxRedirects: 0,
        validateStatus: () => true,
        timeout: 8000,
        headers: { Cookie: serializeJar(jar) },
      },
    );
    mergeSetCookies(jar, step1.headers['set-cookie']);
    const json1 = parseMiJson<{ _sign: string }>(decodeUtf8(step1.data));
    if (!json1?._sign) throw new Error('Mi Cloud: serviceLogin failed (no _sign)');

    // Step 2: serviceLoginAuth2 — login сам.
    const form = new URLSearchParams({
      sid: 'xiaomiio',
      hash: this.passwordHash,
      callback: 'https://sts.api.io.mi.com/sts',
      qs: '%3Fsid%3Dxiaomiio%26_json%3Dtrue',
      user: this.username,
      _sign: json1._sign,
      _json: 'true',
    });

    const step2 = await axios.post<ArrayBuffer>(
      'https://account.xiaomi.com/pass/serviceLoginAuth2',
      form.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: serializeJar(jar),
        },
        responseType: 'arraybuffer',
        timeout: 8000,
      },
    );
    mergeSetCookies(jar, step2.headers['set-cookie']);

    const json2 = parseMiJson<{
      ssecurity?: string;
      userId?: number;
      location?: string;
      code?: number;
      desc?: string;
      notificationUrl?: string;
      captchaUrl?: string | null;
    }>(decodeUtf8(step2.data));
    if (!json2?.ssecurity || !json2.location || !json2.userId) {
      // code: 0 без ssecurity = аккаунт под 2FA / device-verification;
      // Xiaomi возвращает notificationUrl, нужно подтвердить вход в Mi Home app.
      // code: 70016 = wrong password. code: -7 = blocked UA. code: 87001 = captcha.
      const code = json2?.code ?? 'unknown';
      const desc = json2?.desc ?? 'unknown';
      if (json2?.code === 0 && json2?.notificationUrl) {
        throw new Error(
          `Mi Cloud: требуется подтверждение входа. Откройте Mi Home / SMS и подтвердите вход с этого устройства, затем повторите Проверку. Если не приходит — проверьте регион аккаунта.`,
        );
      }
      if (json2?.captchaUrl) {
        throw new Error(
          `Mi Cloud: требуется captcha. Войдите один раз через https://account.xiaomi.com/ из этого браузера, затем повторите Проверку.`,
        );
      }
      if (json2?.code === 70016) {
        throw new Error(
          `Mi Cloud: неверный логин или пароль (code 70016). Проверьте Mi ID и пароль; если включена 2FA — войдите в приложение Mi Home хотя бы раз.`,
        );
      }
      throw new Error(`Mi Cloud login failed (code ${code}): ${desc}`);
    }

    // Step 3: получить serviceToken из location URL.
    const step3 = await axios.get<ArrayBuffer>(json2.location, {
      responseType: 'arraybuffer',
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 8000,
      headers: { Cookie: serializeJar(jar) },
    });
    const setCookies3 = step3.headers['set-cookie'] ?? [];
    const serviceToken = extractCookie(setCookies3, 'serviceToken');
    if (!serviceToken) throw new Error('Mi Cloud: no serviceToken cookie');

    this.session = {
      userId: String(json2.userId),
      ssecurity: json2.ssecurity,
      serviceToken,
    };
    return this.session;
  }
}

function serializeJar(jar: Map<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of jar) parts.push(`${k}=${v}`);
  return parts.join('; ');
}

// Сливает Set-Cookie заголовки в jar — берём только name=value, игнорируем
// атрибуты (Domain/Path/Max-Age): Xiaomi auth-flow короткий, expiry не нужен.
function mergeSetCookies(jar: Map<string, string>, headers: string[] | undefined): void {
  if (!headers) return;
  for (const raw of headers) {
    const first = raw.split(';', 1)[0];
    if (!first) continue;
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name) jar.set(name, value);
  }
}

function signNonce(ssecurity: string, nonce: string): string {
  // SHA-256 (ssecurity_bytes || nonce_bytes), base64 — соответствует
  // `_signed_nonce` в Xiaomi-cloud-tokens-extractor.
  const hash = createHash('sha256');
  hash.update(Buffer.from(ssecurity, 'base64'));
  hash.update(Buffer.from(nonce, 'base64'));
  return hash.digest('base64');
}

/**
 * SHA-1 подпись для enc-mode API. Соответствует `generate_enc_signature`:
 *   signature_string = [METHOD, path, ...k=v_in_order, signed_nonce].join('&')
 *   signature = base64(sha1(signature_string))
 *
 * Это НЕ HMAC — обычный sha1 хеш строки. Параметры в порядке insertion'а
 * (Python dict preserves order; у нас Object с предсказуемым order для string keys).
 */
function generateEncSignature(
  path: string,
  method: string,
  signedNonce: string,
  params: Record<string, string>,
): string {
  const parts: string[] = [method.toUpperCase(), path];
  for (const [k, v] of Object.entries(params)) parts.push(`${k}=${v}`);
  parts.push(signedNonce);
  return createHash('sha1').update(parts.join('&'), 'utf8').digest('base64');
}

/**
 * RC4 поток-шифр с обязательным warmup на 1024 нулевых байт ДО шифрования —
 * Xiaomi-specific требование. Без warmup сервер возвращает 401 (signature mismatch).
 * Используется для шифрования каждого field в params и для decrypt response body.
 *
 * Реализация ручная (не через node:crypto) — `rc4` cipher deprecated в OpenSSL 3,
 * `crypto.createCipheriv('rc4', key, '')` бросает `Unsupported algorithm`.
 */
function rc4WithWarmup(keyB64: string, plaintext: Buffer): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i]! + key[i % key.length]!) & 0xff;
    const tmp = S[i]!;
    S[i] = S[j]!;
    S[j] = tmp;
  }
  // Warmup: прогон 1024 нулевых байт через keystream (output отбрасываем).
  let i2 = 0;
  let j2 = 0;
  for (let n = 0; n < 1024; n++) {
    i2 = (i2 + 1) & 0xff;
    j2 = (j2 + S[i2]!) & 0xff;
    const tmp = S[i2]!;
    S[i2] = S[j2]!;
    S[j2] = tmp;
  }
  // Реальное шифрование plaintext.
  const out = Buffer.alloc(plaintext.length);
  for (let n = 0; n < plaintext.length; n++) {
    i2 = (i2 + 1) & 0xff;
    j2 = (j2 + S[i2]!) & 0xff;
    const tmp = S[i2]!;
    S[i2] = S[j2]!;
    S[j2] = tmp;
    const K = S[(S[i2]! + S[j2]!) & 0xff]!;
    out[n] = plaintext[n]! ^ K;
  }
  return out;
}

/**
 * Per-model MiOT-spec маппинг для пылесосов. siid/piid/aiid отличаются у разных
 * вендоров — миррорить чужой spec на свой = баги типа «ON отправляет на док».
 *
 * Sources:
 *   - https://miot-spec.org/miot-spec-v2/
 *   - python-miio dreamevacuum_miot.py (_DREAME_1C_MAPPING / _DREAME_F9_MAPPING)
 *   - hass-xiaomi-miot per-model mappings.
 */
interface MiotVacuumSpec {
  status: { siid: number; piid: number };
  battery: { siid: number; piid: number };
  fanMode: { siid: number; piid: number };
  /** Маппинг raw status value → наш state-code. */
  statusMap: Record<number, number>;
  fanFromRaw(raw: number): number;
  fanToRaw(fanPower: number): number;
  startAction: { siid: number; aiid: number };
  dockAction: { siid: number; aiid: number };
  /** Дополнительные read-only properties (опциональные у некоторых моделей). */
  cleaningTime?: { siid: number; piid: number };
  cleaningArea?: { siid: number; piid: number };
  /** Water-flow level — поддерживается только моделями с моп-функцией. */
  waterFlow?: { siid: number; piid: number };
}

// ─── Dreame 1C (mc1808): уникальный layout, status@3:2 (special edition) ──────
const DREAME_1C: MiotVacuumSpec = {
  status: { siid: 3, piid: 2 },
  battery: { siid: 2, piid: 1 },
  fanMode: { siid: 18, piid: 6 },
  statusMap: { 1: 5, 2: 3, 3: 10, 4: 12, 5: 6, 6: 8 },
  fanFromRaw: (raw) => 101 + Math.max(0, Math.min(3, raw)),
  fanToRaw: (fan) => Math.max(0, Math.min(3, fan - 101)),
  startAction: { siid: 3, aiid: 1 },
  dockAction: { siid: 2, aiid: 1 },
  cleaningTime: { siid: 18, piid: 2 },
  cleaningArea: { siid: 18, piid: 4 },
  // У Mi Robot Vacuum-Mop 1C нет water-control (no mop variant). waterFlow не задан.
};

// ─── Dreame F9-family: status@2:1, service:4 для cleaning + water_flow@4:5 ───
const DREAME_F9: MiotVacuumSpec = {
  status: { siid: 2, piid: 1 },
  battery: { siid: 3, piid: 1 },
  fanMode: { siid: 4, piid: 4 },
  statusMap: { 1: 5, 2: 3, 3: 10, 4: 12, 5: 6, 6: 8 },
  fanFromRaw: (raw) => 101 + Math.max(0, Math.min(3, raw)),
  fanToRaw: (fan) => Math.max(0, Math.min(3, fan - 101)),
  startAction: { siid: 4, aiid: 1 },
  dockAction: { siid: 3, aiid: 1 },
  cleaningTime: { siid: 4, piid: 2 },
  cleaningArea: { siid: 4, piid: 3 },
  waterFlow: { siid: 4, piid: 5 },
};

// ─── Roborock S5/S6 на MiOT (большинство S5/S6 на legacy miIO, но S7+ через Mi Home идут MiOT) ──
const ROBOROCK_S5: MiotVacuumSpec = {
  status: { siid: 2, piid: 1 },
  battery: { siid: 3, piid: 1 },
  fanMode: { siid: 2, piid: 2 },
  statusMap: { 0: 3, 1: 5, 2: 8, 3: 10, 4: 6, 5: 7, 6: 12 },
  fanFromRaw: (raw) => 101 + Math.max(0, Math.min(3, raw)),
  fanToRaw: (fan) => Math.max(0, Math.min(3, fan - 101)),
  startAction: { siid: 2, aiid: 1 },
  dockAction: { siid: 3, aiid: 1 },
};

const MIOT_VACUUM_SPECS: Record<string, MiotVacuumSpec> = {
  // Dreame Mi Robot Vacuum-Mop 1C (special edition).
  'dreame.vacuum.mc1808': DREAME_1C,
  // Dreame F9-family (D9, Z10 Pro, L10 Pro, Mop 2/Pro+/Ultra, Trouver Finder, D10+, L10S Ultra).
  'dreame.vacuum.p2008': DREAME_F9, // F9
  'dreame.vacuum.p2009': DREAME_F9, // D9
  'dreame.vacuum.p2028': DREAME_F9, // Z10 Pro
  'dreame.vacuum.p2029': DREAME_F9, // L10 Pro
  'dreame.vacuum.p2036': DREAME_F9, // Trouver Finder
  'dreame.vacuum.p2041o': DREAME_F9, // Mop 2 Pro+
  'dreame.vacuum.p2150a': DREAME_F9, // Mop 2 Ultra
  'dreame.vacuum.p2150o': DREAME_F9, // Mop 2
  'dreame.vacuum.r2205': DREAME_F9, // D10 Plus
  'dreame.vacuum.r2228o': DREAME_F9, // L10S Ultra
  // Roborock на MiOT (S5/S6/S7 базовые конфигурации).
  'roborock.vacuum.s5': ROBOROCK_S5,
  'roborock.vacuum.s5e': ROBOROCK_S5,
  'roborock.vacuum.s6': ROBOROCK_S5,
  'roborock.vacuum.s7': ROBOROCK_S5,
};

/** Резолвит spec по model. Префикс-match для unknown моделей одного вендора. */
function resolveVacuumSpec(model: string): MiotVacuumSpec {
  const exact = MIOT_VACUUM_SPECS[model];
  if (exact) return exact;
  if (model === 'dreame.vacuum.mc1808') return DREAME_1C;
  // Любая dreame.vacuum.* — F9-family (новые модели Dreame используют F9 layout).
  if (model.startsWith('dreame.vacuum')) return DREAME_F9;
  // Roborock и Mi/Mijia близкие к S5.
  return ROBOROCK_S5;
}

/** Shape get_status response для Roborock/Mijia пылесосов. */
interface VacuumStatusRaw {
  state: number;
  battery: number;
  fan_power: number;
  water_box_mode?: number;
  clean_time: number;
  clean_area: number;
  in_cleaning: number;
  error_code: number;
}

/** miIO `fan_power` → канон Yandex `mode/work_speed`. См. XiaomiRobotVacuumProtocol. */
function fanPowerToMode(fan: number): string {
  if (fan === 101) return 'quiet';
  if (fan === 102) return 'normal';
  if (fan === 103) return 'turbo';
  if (fan === 104) return 'max';
  return 'normal';
}

function modeToFanPower(mode: string): number | null {
  if (mode === 'quiet') return 101;
  if (mode === 'normal') return 102;
  if (mode === 'turbo') return 103;
  if (mode === 'max') return 104;
  return null;
}

/** miIO `water_box_mode` (200/201/202) → канон Yandex `mode/water_level`. */
function waterBoxModeToMode(level: number): string {
  if (level === 200) return 'low';
  if (level === 202) return 'high';
  return 'normal';
}

function modeToWaterBox(mode: string): number | null {
  if (mode === 'low') return 200;
  if (mode === 'normal') return 201;
  if (mode === 'high') return 202;
  return null;
}

function inferType(model: string): DeviceType {
  const m = model.toLowerCase();
  if (m.includes('vacuum') || m.includes('roborock')) return DEVICE_TYPE.VACUUM;
  if (m.includes('humidifier')) return DEVICE_TYPE.HUMIDIFIER;
  if (m.includes('purifier')) return DEVICE_TYPE.PURIFIER;
  if (m.includes('fan')) return DEVICE_TYPE.FAN;
  if (m.includes('plug')) return DEVICE_TYPE.SOCKET;
  if (m.includes('light') || m.includes('bulb') || m.includes('lamp') || m.includes('yeelink')) {
    return DEVICE_TYPE.LIGHT;
  }
  if (m.includes('sensor') || m.includes('aqara')) return DEVICE_TYPE.SENSOR;
  if (m.includes('curtain')) return DEVICE_TYPE.CURTAIN;
  return DEVICE_TYPE.OTHER;
}
