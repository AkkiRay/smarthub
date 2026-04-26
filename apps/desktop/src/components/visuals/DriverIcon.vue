<template>
  <span
    class="driver-icon"
    :class="[`driver-icon--${size}`, `driver-icon--${driver}`, { 'is-active': active }]"
    :style="{ '--driver-accent': accent }"
    :aria-hidden="true"
  >
    <span class="driver-icon__halo" />
    <span class="driver-icon__core">
      <!-- Yeelight: lightbulb с rays. -->
      <svg v-if="driver === 'yeelight'" viewBox="0 0 32 32" fill="none">
        <g class="driver-icon__rays">
          <path
            d="M16 3v3M16 26v3M3 16h3M26 16h3M6.5 6.5l2 2M23.5 23.5l2 2M6.5 25.5l2-2M23.5 8.5l2-2"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </g>
        <circle cx="16" cy="16" r="6" stroke="currentColor" stroke-width="1.6" />
        <circle cx="16" cy="16" r="2.4" fill="currentColor" class="driver-icon__yeelight-dot" />
      </svg>

      <!-- Shelly: квадрат + HTTP RPC wave. -->
      <svg v-else-if="driver === 'shelly'" viewBox="0 0 32 32" fill="none">
        <rect x="5" y="7" width="22" height="18" rx="3" stroke="currentColor" stroke-width="1.6" />
        <path
          d="M9 16h2.5l1.5-3 3 6 1.5-3H22.5"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="driver-icon__shelly-wave"
        />
      </svg>

      <!-- Tuya: облако + sync-точка. -->
      <svg v-else-if="driver === 'tuya'" viewBox="0 0 32 32" fill="none">
        <path
          d="M11 22a5 5 0 110-10 6 6 0 0111-3.5 5 5 0 015 5 4.5 4.5 0 01-4.5 4.5H11z"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linejoin="round"
          class="driver-icon__tuya-cloud"
        />
        <circle cx="16" cy="16.5" r="1.6" fill="currentColor" class="driver-icon__tuya-dot" />
      </svg>

      <!-- MQTT: концентрические дуги (pub/sub). -->
      <svg v-else-if="driver === 'mqtt'" viewBox="0 0 32 32" fill="none">
        <path
          d="M5 26a14 14 0 0114-14"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          class="driver-icon__mqtt-arc driver-icon__mqtt-arc--a"
        />
        <path
          d="M5 20a8 8 0 018-8"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          class="driver-icon__mqtt-arc driver-icon__mqtt-arc--b"
        />
        <circle cx="6.5" cy="25.5" r="2" fill="currentColor" class="driver-icon__mqtt-dot" />
      </svg>

      <!-- Generic HTTP: тег </> + arrow. -->
      <svg v-else-if="driver === 'generic-http'" viewBox="0 0 32 32" fill="none">
        <path
          d="M11 11l-5 5 5 5"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M21 11l5 5-5 5"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path d="M18 9l-4 14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
      </svg>

      <!-- Yandex Station: voice-wave. -->
      <svg v-else-if="driver === 'yandex-station'" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="11" stroke="currentColor" stroke-width="1.6" />
        <path
          d="M11 14v4M14 12v8M17 13v6M20 14v4M23 15v2"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          class="driver-icon__alice-wave"
        />
      </svg>

      <!-- Fallback. -->
      <svg v-else viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="11" stroke="currentColor" stroke-width="1.6" />
        <path
          d="M11 16h10M16 11v10"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DriverId } from '@smarthome/shared';
import { driverAccent } from '@/constants/driverPalette';

const props = withDefaults(
  defineProps<{
    driver: DriverId;
    /** sm = 32, md = 44, lg = 56. */
    size?: 'sm' | 'md' | 'lg';
    /** «Активный» state — глиф анимируется живее, halo ярче. */
    active?: boolean;
  }>(),
  { size: 'md', active: false },
);

const accent = computed(() => driverAccent(props.driver));
</script>

<style scoped lang="scss">
.driver-icon {
  --driver-accent: var(--color-brand-purple);
  --driver-size: 44px;
  position: relative;
  width: var(--driver-size);
  height: var(--driver-size);
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  isolation: isolate;

  &--sm {
    --driver-size: 32px;
  }
  &--md {
    --driver-size: 44px;
  }
  &--lg {
    --driver-size: 56px;
  }

  // Halo выключен в плоском дизайне.
  &__halo {
    display: none;
  }

  &__core {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: calc(var(--driver-size) * 0.27);
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--driver-accent) 14%, transparent);
    color: var(--driver-accent);
    transition: background 160ms var(--ease-out);

    svg {
      width: 60%;
      height: 60%;
    }
  }

  &.is-active &__core {
    background: color-mix(in srgb, var(--driver-accent) 22%, transparent);
  }

  // Per-driver micro-animations — «оживший» глиф.

  // Yeelight: ядро дышит, rays мерцают.
  &__yeelight-dot {
    transform-origin: center;
    animation: ydDot 2.6s ease-in-out infinite;
  }
  &__rays > path {
    animation: ydRay 2.6s ease-in-out infinite;
    transform-origin: center;
  }

  // Shelly: волна цикла.
  &__shelly-wave {
    stroke-dasharray: 36;
    stroke-dashoffset: 0;
    animation: shellyDash 4.6s linear infinite;
  }

  // Tuya: pulse cloud-sync.
  &__tuya-cloud {
    animation: tuyaCloud 3.6s ease-in-out infinite;
    transform-origin: center;
  }
  &__tuya-dot {
    animation: tuyaDot 1.6s ease-in-out infinite;
  }

  // MQTT: дуги — broker-signal.
  &__mqtt-arc {
    stroke-dasharray: 30;
    stroke-dashoffset: 30;
    animation: mqttArc 2.4s ease-out infinite;
    &--a {
      animation-delay: 0s;
    }
    &--b {
      animation-delay: 0.5s;
    }
  }
  &__mqtt-dot {
    animation: mqttBlip 1.6s ease-in-out infinite;
    transform-origin: center;
  }

  // Алиса: эквалайзер.
  &__alice-wave > path {
    animation: aliceWave 1.4s ease-in-out infinite;
    transform-origin: center;
  }
  &__alice-wave > path:nth-child(1) {
    animation-delay: 0s;
  }
  &__alice-wave > path:nth-child(2) {
    animation-delay: 0.12s;
  }
  &__alice-wave > path:nth-child(3) {
    animation-delay: 0.24s;
  }
  &__alice-wave > path:nth-child(4) {
    animation-delay: 0.36s;
  }
  &__alice-wave > path:nth-child(5) {
    animation-delay: 0.48s;
  }
}

// reduce-motion: гасим анимации, форма остаётся.
.app--reduce-motion .driver-icon {
  &__yeelight-dot,
  &__rays > path,
  &__shelly-wave,
  &__tuya-cloud,
  &__tuya-dot,
  &__mqtt-arc,
  &__mqtt-dot,
  &__alice-wave > path {
    animation: none !important;
  }
}

@keyframes ydDot {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.95;
  }
  50% {
    transform: scale(1.4);
    opacity: 1;
  }
}
@keyframes ydRay {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}
@keyframes shellyDash {
  to {
    stroke-dashoffset: -36;
  }
}
@keyframes tuyaCloud {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-1px);
  }
}
@keyframes tuyaDot {
  0%,
  100% {
    opacity: 0.45;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}
@keyframes mqttArc {
  0% {
    stroke-dashoffset: 30;
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  60% {
    stroke-dashoffset: 0;
    opacity: 1;
  }
  100% {
    stroke-dashoffset: -30;
    opacity: 0;
  }
}
@keyframes mqttBlip {
  0%,
  100% {
    transform: scale(0.85);
    opacity: 0.7;
  }
  50% {
    transform: scale(1.15);
    opacity: 1;
  }
}
@keyframes aliceWave {
  0%,
  100% {
    transform: scaleY(1);
  }
  50% {
    transform: scaleY(0.55);
  }
}
</style>
