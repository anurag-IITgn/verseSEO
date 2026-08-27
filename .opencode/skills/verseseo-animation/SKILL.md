---
name: verseseo-animation
description: Use when designing, implementing, or debugging frontend animations, scroll-driven experiences, motion effects, or visual transitions for the VerseSEO website. Covers animation philosophy, scroll-driven module showcases, canvas/particle effects, responsive motion, and accessibility.
---

# VerseSEO Animation Skill

Guidelines for designing and implementing high-quality frontend animations in the VerseSEO Astro + Tailwind codebase.

## 1. Design Philosophy

VerseSEO is a premium AI/SEO SaaS product. Animations should:

- Communicate the product and improve comprehension — not exist as decoration
- Feel sophisticated, restrained, intentional, and modern
- Never feel like a gaming website, generic template, or marketing gimmick

**Avoid:** excessive bouncing, constant spinning, flashy/glitch effects, animations that call attention to themselves rather than the content.

**Prefer:** subtle motion that guides the eye, smooth transitions that connect ideas, ambient effects that create atmosphere without demanding attention.

## 2. Motion Hierarchy

Motion has a strict priority order. Never animate every element simultaneously.

| Priority | Layer | Motion Intensity | Examples |
|----------|-------|-----------------|----------|
| 1 | Active product/module visual | Strongest | Card entrance, mockup reveal, data animation |
| 2 | Section transitions | Moderate | Scroll-driven module switching, fade/slide between states |
| 3 | Supporting UI | Restrained | Hover states, button feedback, nav indicators |
| 4 | Background/ambient | Subtle | Particles, glows, gradient movement |

Motion should guide the user's eye toward the important information. If everything moves, nothing stands out.

## 3. Scroll-Driven Experiences

The ModulesExperience section is the reference implementation. Key principles:

**Before implementing individual transitions, design the complete scroll experience:**
- Define entry, active, transition, and exit states for each module
- Map scroll progress to module states with clear thresholds
- Plan the visual flow from module 01 through 05 as a continuous narrative

**Module transitions should feel continuous:**
- Use opacity + transform transitions (not abrupt show/hide)
- Allow incoming and outgoing states to overlap briefly during transitions
- The active module receives the strongest visual treatment

**Never allow the active module to become partially hidden:**
- Do not use `overflow: hidden` on sticky containers — use `overflow: visible`
- Do not create fixed heights that clip content — use `min-height` or natural flow
- Do not nest scrolling areas merely to make a visual fit
- Constrain oversized visuals with `max-height` + `overflow-y: auto` only when the UX explicitly requires internal scroll (e.g., a long mock dashboard)
- Prefer responsive sizing, natural layout, and viewport-aware dimensions so complete content remains visible

**Test the complete sequence:** Scroll from module 01 through 05, then back. Verify every transition, every active state, every exit.

## 4. Visual Effects

Effects must be subordinate to the actual product UI. Choose effects that match the module's meaning:

| Module Domain | Appropriate Effects |
|--------------|-------------------|
| Technical SEO / Health | Scanning indicators, progress states, check/warning signals |
| Search / Keywords | Query movement, result card reveals, score counters |
| Reddit / Community | Thread cards, upvote/comment signals, sentiment indicators |
| AI / Visibility | Citation signals, engine cards, network/node connections |
| Content / Pipeline | Document assembly, stage transitions, brief-to-draft flow |
| Background / Ambient | Subtle particles/dots, gradient shifts, light movement |

All background effects must be absolutely positioned with `pointer-events: none` — they never participate in layout flow.

## 5. Technical Implementation

**Performance-first animation:**
- Prefer CSS `transform` and `opacity` — they are GPU-composited and do not trigger layout
- Avoid animating `width`, `height`, `top`, `left`, `margin`, `padding` — these trigger layout recalculation
- Use `cubic-bezier(0.16, 1, 0.3, 1)` for natural deceleration (the project standard easing)

**Scroll handling:**
- Use `requestAnimationFrame` for scroll-driven JavaScript — never raw `scroll` events without throttling
- Use `IntersectionObserver` when it is a better fit than continuous scroll calculation (e.g., triggering entrance animations on scroll-in)
- Avoid unnecessary JavaScript animation loops — prefer CSS transitions/animations where possible

**Architecture:**
- Respect the existing Astro + vanilla JavaScript architecture — no React/Vue/Svelte
- Do not introduce a new animation library unless there is a clear benefit and the existing project cannot reasonably achieve the effect
- All `<script>` tags are inline and bundled by Astro automatically

## 6. Responsive Behavior

Desktop and mobile are different presentation modes. Never simply shrink a complex desktop animation until it becomes unusable.

**Mobile rules:**
- Disable or simplify complex scroll/sticky animations on mobile (e.g., ModulesExperience uses `position: relative; height: auto` with all cards stacked on screens below 640px)
- Never introduce horizontal overflow
- Never clip important product UI
- Ensure touch targets are at least 44px
- Test at 390px width — nothing should scroll horizontally

**Breakpoints:** sm (640px), md (768px), lg (1024px), xl (1280px). Custom CSS media queries at `max-width: 1023px` (modules nav hidden) and `max-width: 639px` (mobile stacked mode).

## 7. Accessibility

**`prefers-reduced-motion: reduce` is mandatory.**

When reduced motion is preferred:
- Set `animation-duration: 0.01ms !important` and `transition-duration: 0.01ms !important`
- Show all content immediately (no hidden cards waiting for scroll)
- Disable sticky positioning — use `position: relative; height: auto`
- Preserve information hierarchy — all content visible, just without movement

The ModulesExperience reduced-motion block in `global.css` is the reference pattern.

## 8. Verification

**A successful build is not visual verification.** Build passing means zero syntax errors — it does not mean the layout is correct.

**Verification checklist:**
1. Start the dev server (`npm run dev` or `astro dev --background`)
2. Open the page in a browser
3. **Desktop (1366x768):** All content visible, nothing clipped, no horizontal overflow, no giant empty gaps, sticky/scroll behavior works
4. **Mobile (390x844):** Single column, no horizontal scroll, all content accessible, touch targets adequate
5. **Scroll through the complete experience:** Module entry, active state, transitions, exit
6. **Check for:** clipping, overflow, broken sticky positioning, giant empty spaces, partially visible mockups
7. **Check `prefers-reduced-motion`:** Animations should be disabled or minimal

## 9. Existing VerseSEO Design Tokens

Reuse these — do not introduce unrelated visual styles.

**CSS variables (defined in `global.css` `@layer base`):**
- Surfaces: `--color-bg-main` (#faf9f5), `--color-bg-card` (#fff), `--color-surface-dark` (#0c1021), `--color-surface-dark-elevated` (#141929)
- Text: `--color-text-primary` (#0f172a), `--color-text-secondary` (#475569), `--color-text-on-dark` (#f8fafc), `--color-text-on-dark-muted` (#94a3b8)
- Brand: `--color-brand-blue` (#2563eb), `--color-brand-indigo` (#4f46e5), `--color-brand-violet` (#7c3aed)
- Semantic: `--color-organic` (#22c55e), `--color-reddit` (#ff4500), `--color-ai-primary` (#6366f1), `--color-search` (#3b82f6)
- Borders: `--color-border-light`, `--color-border-dark`, `--color-border-accent`

**Reusable CSS classes:**
- `glass-panel` / `glass-panel-dark` — frosted glass surfaces
- `card-hover` — lift + shadow on hover
- `animate-fade-in`, `animate-float`, `animate-pulse-slow` — existing keyframes
- `surface-dark`, `surface-card`, `surface-elevated` — themed backgrounds
- `tag-emerald`, `tag-blue`, `tag-orange`, `tag-violet`, `tag-indigo` — module badge colors
- `bullet-emerald`, `bullet-blue`, `bullet-orange`, `bullet-violet`, `bullet-indigo` — module bullet colors

**Fonts:** Plus Jakarta Sans (body), JetBrains Mono (monospace). Do not load additional fonts without approval.

**Preserve existing functionality:** Never modify backend API URLs, authentication flow, billing integration, environment variables, or production configuration while working on animations.
