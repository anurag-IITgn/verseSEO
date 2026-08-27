## Development

```sh
npm run dev        # dev server at localhost:4321
npm run build      # static output to dist/
npm run preview    # preview production build
```

Background dev server: `astro dev --background`, `astro dev stop`, `astro dev status`, `astro dev logs`.

There are **no lint, typecheck, or test scripts** in package.json. This is a static marketing site with no test suite. If you add tooling, wire it into package.json scripts.

Node >=22.12.0 required.

## Architecture

Single-page Astro 7 static marketing site ("VerseSEO"). No routing — everything is in `src/pages/index.astro`. All components are pure `.astro` (no React/Vue/Svelte).

- `src/components/` — page sections (Hero, Pricing, FAQ, etc.)
- `src/components/visuals/` — decorative visuals for the 5 feature modules
- `src/layouts/Layout.astro` — base HTML shell, SEO meta, Google Fonts
- `src/styles/global.css` — Tailwind v4 import, CSS custom properties, utility classes
- `public/` — favicon only; images are inline SVG or CSS-driven

## Styling

Tailwind v4 via `@tailwindcss/vite` plugin (not the older `tailwind.config` approach). Global CSS variables are defined in `src/styles/global.css` `@layer base`.

Custom CSS classes used across components: `glass-panel`, `card-hover`, `animate-fade-in`, `animate-float`, `animate-pulse-slow`. Use these rather than reinventing effects.

Fonts: Plus Jakarta Sans (body), JetBrains Mono (monospace). Loaded via Google Fonts in Layout.astro.

Brand colors: blue (#2563eb), indigo (#4f46e5), violet (#7c3aed). Each feature module has a badge theme (emerald, blue, orange, violet, indigo) passed via `badgeTheme` prop.

## Component Conventions

Components follow a consistent pattern:
- Frontmatter (between `---`) handles logic and props via `interface Props`
- Layout uses a 12-column grid (`grid-cols-12`) with `lg:col-span-*` for text/visual splits
- The `FeatureSection` component accepts `layout="text-left" | "text-right"` to alternate sides
- Visual components are passed as `<slot />` children of FeatureSection
- Inline `<script>` tags (no framework) handle interactivity — Astro bundles these automatically

## Animation & Motion Rules

1. **Always check `prefers-reduced-motion`** — disable or simplify animations for users who request reduced motion.
2. **Use existing keyframes** (`fadeIn`, `floatSlow`, `pulseSlow`) and Tailwind's `animate-*` utilities. Do not create new keyframe animations without adding them to `global.css`.
3. **Scroll-driven animations** (like ModulesExperience) must:
   - Use `requestAnimationFrame` for scroll handlers (never raw scroll events without throttling)
   - Keep `overflow: visible` on sticky containers — never `overflow: hidden` on presentation areas
   - Use the simplest reliable transition architecture appropriate to the component. For mutually exclusive module presentations, opacity/transform transitions with properly layered elements are allowed when they do not cause clipping or layout instability. Avoid JS-measured heights unless genuinely necessary.
   - Never solve an oversized visual by creating an internal scrolling card unless the UX explicitly requires it. Prefer responsive sizing, natural layout, and appropriate viewport-aware dimensions so the complete important content remains visible.
4. **Canvas/particle effects** must be absolutely positioned and `pointer-events: none` — they never participate in layout flow.
5. **Transitions on interactive elements:** `transition-all duration-300` or `duration-500` with `cubic-bezier(0.16, 1, 0.3, 1)` easing.
6. **No animation should cause content to extend outside the viewport or clip visible content.**

## Documentation

Astro docs MCP server is configured in `opencode.json`. Use the Astro docs search tool for framework questions.

Key reference guides:
- [Astro routing](https://docs.astro.build/en/guides/routing/)
- [Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Tailwind styling](https://docs.astro.build/en/guides/styling/)
