<template>
  <section class="home home--skeleton" aria-busy="true" aria-label="Загрузка панели">
    <header class="home__hero home__hero--skeleton">
      <div class="home__hero-copy">
        <span class="skeleton skeleton--pill home__sk-pill" />
        <span class="skeleton skeleton--line home__sk-title" />
        <span class="skeleton skeleton--line home__sk-title home__sk-title--narrow" />
        <span class="skeleton skeleton--line home__sk-lead" />
        <div class="home__sk-actions">
          <span class="skeleton skeleton--rounded-pill home__sk-btn" />
          <span class="skeleton skeleton--rounded-pill home__sk-btn home__sk-btn--ghost" />
        </div>
      </div>
      <aside class="home__kpis home__kpis--skeleton">
        <div v-for="n in 4" :key="n" class="home__kpi home__kpi--skeleton">
          <span class="skeleton skeleton--line home__sk-kpi-label" />
          <span class="skeleton skeleton--line home__sk-kpi-value" />
          <span class="skeleton skeleton--line home__sk-kpi-hint" />
        </div>
      </aside>
    </header>

    <section v-for="n in 2" :key="n" class="home__sk-section">
      <header class="home__head">
        <div class="home__sk-head-copy">
          <span class="skeleton skeleton--line home__sk-eyebrow" />
          <span class="skeleton skeleton--line home__sk-section-title" />
        </div>
      </header>
      <div class="home__sk-grid">
        <span v-for="i in 3" :key="i" class="skeleton skeleton--card home__sk-card" />
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
/**
 * @fileoverview HomeSkeleton — shimmer-аналог HomeView для bootstrap-gate'а.
 *
 * Рендерится пока stores (devices/scenes/yandex/drivers) не закончат
 * первичную гидрацию. Layout-размеры подобраны так, чтобы после crossfade
 * на реальный контент высота секций не прыгала.
 */
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.home--skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
  width: 100%;
  align-self: start;

  @media (max-width: 720px) {
    gap: var(--space-4);
  }
}

.home__hero--skeleton {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) auto;
  gap: var(--space-7);
  align-items: center;
  padding: var(--pad-roomy);
  border-radius: var(--radius-xl);
  overflow: hidden;
  isolation: isolate;
  @include glass(var(--glass-alpha-soft), var(--glass-blur-medium));
  box-shadow: var(--depth-2);

  @media (max-width: 1080px) {
    grid-template-columns: minmax(0, 1fr);
  }

  @media (max-width: 720px) {
    padding: var(--pad-comfort);
    border-radius: var(--radius-lg);
    gap: var(--space-4);
  }
}

.home__hero-copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.home__sk-pill {
  width: 84px;
  height: 22px;
}

.home__sk-title {
  height: 36px;
  max-width: 420px;

  &--narrow {
    max-width: 320px;
  }
}

.home__sk-lead {
  height: 16px;
  max-width: 480px;
  margin-top: var(--space-2);
}

.home__sk-actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.home__sk-btn {
  width: 180px;
  height: 44px;

  &--ghost {
    width: 140px;
    background: rgba(255, 255, 255, 0.025);
  }
}

.home__kpis--skeleton {
  display: grid;
  grid-template-columns: repeat(2, minmax(140px, 1fr));
  gap: 1px;
  background: var(--color-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: var(--border-thin) solid var(--color-border-subtle);

  @media (max-width: 1080px) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  @media (max-width: 720px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  @media (max-width: 380px) {
    grid-template-columns: 1fr;
  }
}

.home__kpi--skeleton {
  background: rgba(var(--glass-tint), 0.4);
  padding: var(--space-4) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);

  @media (max-width: 720px) {
    padding: 12px;
    gap: 6px;
  }
}

.home__sk-kpi-label {
  width: 56px;
  height: 10px;
}

.home__sk-kpi-value {
  width: 100%;
  max-width: 120px;
  height: 28px;
  margin-top: var(--space-1);
}

.home__sk-kpi-hint {
  width: 88px;
  height: 10px;
}

.home__sk-section {
  display: flex;
  flex-direction: column;
}

.home__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
  flex-wrap: wrap;
}

.home__sk-head-copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.home__sk-eyebrow {
  width: 96px;
  height: 11px;
}

.home__sk-section-title {
  width: 280px;
  height: 22px;
}

.home__sk-grid {
  @include auto-grid(var(--cell-md), var(--space-3));
}

.home__sk-card {
  height: 168px;
  border-radius: var(--radius-lg);
}
</style>
