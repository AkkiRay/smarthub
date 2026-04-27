# SmartHub Design System

Single source of truth для UI. Любой component обязан:

1. Использовать токены из `src/styles/abstracts/_tokens.scss` — никаких inline px/hex/rgba.
2. Применять mixins/blocks из `src/styles/blocks/` для повторяющихся patterns.
3. Соблюдать density/scale/typography rules из этого документа.

При появлении нового pattern — расширять токены, не дублировать значения.

---

## Brand identity

### Color palette

**Brand gradient** — фирменный знак, идентифицирует бренд за 0.3s:

```
violet (#7c5bff) → purple (#b85dff) → pink (#ff5b9e) → amber (#ffb866) @ 135°
```

Точечно используется в primary CTA, hero overlays, активных progress-индикаторах.
Никогда — на крупных surface'ах (получится «казино»).

**Solid brand tones** (для tone'ов карточек, бейджей, иконок):

| Token                  | Hex       | Использование                   |
| ---------------------- | --------- | ------------------------------- |
| `--color-brand-violet` | `#7c5bff` | Primary, default tile/hint tone |
| `--color-brand-purple` | `#b85dff` | Active state accents            |
| `--color-brand-pink`   | `#ff5b9e` | Alice, voice features           |
| `--color-brand-blue`   | `#5b8dff` | Cloud / network indicators      |
| `--color-brand-cyan`   | `#5bd8ff` | Info states                     |
| `--color-brand-amber`  | `#ffb866` | Discovery, exploratory          |
| `--color-brand-mint`   | `#5be3ad` | Energy, environment             |
| `--color-brand-coral`  | `#ff6e66` | Audio, hot states               |
| `--color-brand-orange` | `#ff8a4d` | Power, output                   |

Каждый имеет `-rgb` triplet для `rgba(var(...), alpha)`.

### Themes

- `alice-dark` (default) — тёплый фиолетовый.
- `alice-midnight` — холодный blue-black.

Темы переопределяют только `--color-bg-*`, `--glass-*`, `--aura-*`. Brand-палитра общая.

---

## Spacing scale

Семантическая шкала, не linear. Каждый шаг — 1.5×.

| Token       | Value | Применение                               |
| ----------- | ----- | ---------------------------------------- |
| `--space-1` | 4     | Тонкая адъюстировка inside chip / button |
| `--space-2` | 8     | Inline gap (icon + text)                 |
| `--space-3` | 12    | Body gap внутри card                     |
| `--space-4` | 16    | Стандарт между card sections             |
| `--space-5` | 20    | Card padding compact                     |
| `--space-6` | 24    | Card padding standard                    |
| `--space-7` | 32    | Section gap                              |
| `--space-8` | 44    | Page section margin                      |
| `--space-9` | 64    | Hero / fullscreen breathing room         |

**Density tokens** (semantic) — для card padding'а:

| Token           | Value                      | Применение                        |
| --------------- | -------------------------- | --------------------------------- |
| `--pad-tight`   | `clamp(12px, 1vw, 16px)`   | Compact list item, dense chip     |
| `--pad-comfort` | `clamp(16px, 1.4vw, 22px)` | Стандартная card                  |
| `--pad-roomy`   | `clamp(20px, 2vw, 32px)`   | Hero, wizard step, marketing card |
| `--pad-grand`   | `clamp(28px, 3vw, 56px)`   | Fullscreen scenes, focus modes    |

---

## Typography

**Шрифты** (variable):

- `--font-family-sans` Inter Variable — body, UI controls.
- `--font-family-display` Manrope Variable — заголовки, hero, KPI.
- `--font-family-mono` JetBrains Mono Variable — eyebrows, kicker, ticks, addresses.

**Type scale** — fluid через `clamp()`:

| Token                   | Min → Max   | Применение                     |
| ----------------------- | ----------- | ------------------------------ |
| `--font-size-display`   | 26 → 44     | Welcome hero, fullscreen title |
| `--font-size-display-2` | 22 → 34     | Wizard step title, page hero   |
| `--font-size-h1`        | 20 → 28     | Section title                  |
| `--font-size-h2`        | 15 → 19     | Card title                     |
| `--font-size-h3`        | 14 → 16     | Sub-heading, tile label        |
| `--font-size-body`      | 13.5 → 14.5 | Body copy                      |
| `--font-size-small`     | 12 → 13     | Secondary body, hint           |
| `--font-size-micro`     | 11          | Eyebrow, kicker, badge label   |

**Line-heights** (semantic):

| Token               | Value | Применение               |
| ------------------- | ----- | ------------------------ |
| `--leading-tight`   | 1.05  | Display headings         |
| `--leading-snug`    | 1.2   | H1/H2                    |
| `--leading-normal`  | 1.4   | Card title, button label |
| `--leading-relaxed` | 1.55  | Body copy, lead          |
| `--leading-loose`   | 1.7   | Long-form prose          |

**Tracking** (letter-spacing) — уже в `--tracking-*` токенах.

---

## Sizing scale

**Icon-box** — токены для квадратных контейнеров иконок:

| Token            | Size | Inside icon | Применение               |
| ---------------- | ---- | ----------- | ------------------------ |
| `--icon-box-xs`  | 24   | 12          | Compact chip             |
| `--icon-box-sm`  | 32   | 16          | List item, small button  |
| `--icon-box-md`  | 40   | 20          | Card header, banner      |
| `--icon-box-lg`  | 48   | 24          | Tile, wizard path        |
| `--icon-box-xl`  | 56   | 28          | Hero feature, KPI        |
| `--icon-box-2xl` | 72   | 36          | Wizard hero, empty state |

**Control height** — input / button / select consistent:

| Token            | Value | Применение               |
| ---------------- | ----- | ------------------------ |
| `--control-h-sm` | 32    | Compact toolbar          |
| `--control-h-md` | 40    | Default (= `--tap-min`)  |
| `--control-h-lg` | 48    | Wizard primary CTA, hero |

**Border width**:

| Token           | Value |
| --------------- | ----- |
| `--border-thin` | 1px   |
| `--border-bold` | 2px   |

---

## Surface system

**Backgrounds** (по depth):

| Token                 | Где                         |
| --------------------- | --------------------------- |
| `--color-bg-base`     | Базовый canvas              |
| `--color-bg-surface`  | Card по умолчанию           |
| `--color-bg-elevated` | Hover state, modal, popover |
| `--color-bg-overlay`  | Modal backdrop              |

**Borders**:

| Token                   | Применение              |
| ----------------------- | ----------------------- |
| `--color-border-subtle` | Default card border     |
| `--color-border-soft`   | Hover, focus secondary  |
| `--color-border-strong` | Selected, focus primary |

**Surface overlays** (для hover/press):

| Token              |
| ------------------ |
| `--surface-hover`  |
| `--surface-press`  |
| `--surface-active` |

**Status soft tones** — для banners/hints/badges (`--tone-{success,warning,danger,info,violet}-{soft,edge}`).

**Glass-морфизм** — три уровня прозрачности (`--glass-alpha-{soft,medium,strong}`) и blur (`--glass-blur-{soft,medium,strong}`). Применяется через `@include glass(...)` mixin.

---

## Shape

**Radius scale**:

| Token           | Value | Применение                |
| --------------- | ----- | ------------------------- |
| `--radius-xs`   | 8     | Inline chip, mini control |
| `--radius-sm`   | 12    | Input, secondary button   |
| `--radius-md`   | 16    | List item, banner         |
| `--radius-lg`   | 22    | Card, tile, panel         |
| `--radius-xl`   | 28    | Hero, wizard step         |
| `--radius-2xl`  | 36    | Fullscreen scene          |
| `--radius-pill` | 999   | Eyebrow, dot, kbd         |

---

## Motion

**Durations** — выбирай по semantics, не по «ощущениям»:

| Token           | Value | Применение                      |
| --------------- | ----- | ------------------------------- |
| `--dur-instant` | 80ms  | Active state response           |
| `--dur-fast`    | 160ms | Hover, micro-interaction        |
| `--dur-medium`  | 280ms | Card transition                 |
| `--dur-slow`    | 480ms | Page enter, modal               |
| `--dur-stage`   | 720ms | Wizard step change, hero reveal |

**Easings**:

| Token             | Curve                          | Применение       |
| ----------------- | ------------------------------ | ---------------- |
| `--ease-out`      | `cubic-bezier(.22,1,.36,1)`    | Default exit     |
| `--ease-snap`     | `cubic-bezier(.4,0,0,1)`       | Material-style   |
| `--ease-spring`   | `cubic-bezier(.34,1.56,.64,1)` | Bounce in        |
| `--ease-emphasis` | `cubic-bezier(.2,0,0,1.2)`     | Slight overshoot |

Все анимации обязаны уважать `prefers-reduced-motion` (через `app--reduce-motion` класс).

---

## Layout primitives

**Page** — каждый view-root:

- `padding: var(--content-pad-y) var(--content-pad-x)` (fluid clamp)
- `gap: var(--content-gap)` между секциями
- Дочерние секции `max-width: var(--content-max)` + `margin-inline: auto`

**Card grid** — повторяющиеся карточки:

- `display: grid`
- `gap: var(--grid-gap)` (compact) или `var(--space-4)` (comfort)
- `grid-template-columns: repeat(auto-fit, minmax(min(100%, <token>), 1fr))`

**Min-cell width tokens** — для grid'ов:

| Token       | Value | Применение                             |
| ----------- | ----- | -------------------------------------- |
| `--cell-sm` | 200px | Chip / tag grid                        |
| `--cell-md` | 240px | Default tile / candidate / device card |
| `--cell-lg` | 320px | Wizard path, hero feature              |
| `--cell-xl` | 380px | Settings group, integration card       |

---

## Components — canonical patterns

### Hero (`.hero`)

Glass-карточка page-header. Eyebrow + title + subtitle + actions + optional visual.

- Padding: `--pad-roomy`
- Radius: `--radius-xl`
- Title: `--font-size-display-2`
- Применять на: Welcome, Home, Discovery, Devices, Rooms, Scenes, Alice, Settings.

### Tile (`.tile`)

Универсальная action-плитка с tone-акцентом. Поддерживает `.tile--{violet,pink,blue,cyan,amber,mint,coral,orange}`, `.tile--glass`, `.tile--accent`, `.tile--interactive`.

- Padding: `--pad-comfort`
- Radius: `--radius-lg`
- Icon-box: `--icon-box-md`
- Заголовок: `--font-size-h2`

### Step / Step-card (`.steps`, `.step-card`)

Wizard-индикатор + step-card контейнер. Используется на Welcome / Pair / Alice setup.

- Step-card padding: `--pad-roomy`
- Radius: `--radius-2xl`
- Title: `--font-size-display-2`
- Lead: `--font-size-body`, `max-width: 64ch`

### Banner (`.banner`)

Inline-уведомление: success/warning/danger/info.

- Padding: `--pad-comfort`
- Radius: `--radius-md`
- Icon-box: `--icon-box-md`

### Chip (`.chip`)

Status-индикатор: dot + текст. Dot — через `.chip__dot`.

- Height: 26px
- Padding: 0 10px
- Radius: `--radius-pill`
- Font: `--font-size-micro`

---

## Density rules

Density выбирается **по плотности информации в view**, не по эстетике:

| Density   | Когда                                                         |
| --------- | ------------------------------------------------------------- |
| `tight`   | Дашборд с большим количеством карточек, list view с >20 items |
| `comfort` | Стандарт: одна secondary task на view                         |
| `roomy`   | Wizard, primary task, focused mode                            |
| `grand`   | Welcome / fullscreen scene, нет sidebar                       |

Внутри одного view density должен быть однородным. Не миксовать tight + roomy.

---

## Accessibility

- Контраст текста vs background ≥ WCAG AA (4.5:1 body, 3:1 large).
- Focus-ring обязателен на каждом interactive (`@include focus-ring`).
- Tap target ≥ `--tap-min` (40 desktop, 44 coarse pointer).
- Все анимации > `--dur-fast` отключаются через `prefers-reduced-motion`.
- Иконки без подписи — `aria-label` или `aria-hidden="true"` если декоративные.

---

## Anti-patterns — не делать

- Hex / rgba inline в SCSS — только token / `rgba(var(--color-*-rgb), a)`.
- Padding/gap/font-size в произвольных px — только токен или `clamp()` через токены.
- Нестандартные radius — добавь в `--radius-*` если повторяется.
- Hover-эффект без transition — `--dur-fast var(--ease-out)` минимум.
- Inline `style="color: ..."` — токен или `:style` с CSS-переменной из state.
- BEM-нарушения: `.parent .child` (cascading) вместо `.parent__child`.
- Tag-selectors внутри блока (`.card h2 { ... }`) — используй `.card__title`.
- `!important` — никогда (кроме reset / utility).
