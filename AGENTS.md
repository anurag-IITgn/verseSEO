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

Single-page Astro 7 static marketing site ("Foundable"). No routing — everything is in `src/pages/index.astro`. All components are pure `.astro` (no React/Vue/Svelte).

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

## Documentation

Astro docs MCP server is configured in `opencode.json`. Use the Astro docs search tool for framework questions.

Key reference guides:
- [Astro routing](https://docs.astro.build/en/guides/routing/)
- [Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Tailwind styling](https://docs.astro.build/en/guides/styling/)
