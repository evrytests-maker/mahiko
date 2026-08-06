## Design System: ma-hi-ko visual QA

### Design Dials
- **Variance:** 5/10 — Balanced / Modern
- **Motion:** 2/10 — Subtle
- **Density:** 9/10 — Dense / Dashboard

### Pattern
- **Name:** Product Review/Ratings Focused
- **Conversion Focus:** User-generated content builds trust. Show verified purchases. Filter by rating. Respond to negative reviews.
- **CTA Placement:** After reviews summary + Buy button alongside reviews
- **Color Strategy:** Trust colors. Star ratings gold. Verified badge green. Review sentiment colors.
- **Sections:** 1. Hero (product + aggregate rating), 2. Rating breakdown, 3. Individual reviews, 4. Buy/CTA

### Style
- **Name:** Dark Mode (OLED)
- **Mode Support:** Light ✗ No | Dark ✓ Only
- **Keywords:** Dark theme, low light, high contrast, deep black, midnight blue, eye-friendly, OLED, night mode, power efficient
- **Best For:** Night-mode apps, coding platforms, entertainment, eye-strain prevention, OLED devices, low-light
- **Performance:** ⚡ Excellent | **Accessibility:** ✓ WCAG AAA

### Colors
| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#0F172A` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#1E293B` | `--color-secondary` |
| Accent/CTA | `#22C55E` | `--color-accent` |
| Background | `#020617` | `--color-background` |
| Foreground | `#F8FAFC` | `--color-foreground` |
| Muted | `#1A1E2F` | `--color-muted` |
| Border | `#334155` | `--color-border` |
| Destructive | `#EF4444` | `--color-destructive` |
| Ring | `#0F172A` | `--color-ring` |

*Notes: Terminal dark + success green*

### Typography
- **Heading:** JetBrains Mono
- **Body:** JetBrains Mono
- **Mood:** terminal, cli, hacker, monospace, matrix, developer, retro-future, command line, precision, OLED
- **Best For:** Developer tools, Web3/blockchain apps, hacker aesthetic, sci-fi games, ARG, security tools, geek-culture portfolios
- **Google Fonts:** https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;1,400
- **CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;1,400&display=swap');
```

### Key Effects
Minimal glow (text-shadow: 0 0 10px), dark-to-light transitions, low white emission, high readability, visible focus

### Motion
**Scroll Reveal** (Subtle) — Trigger: scroll (viewport enter) | Duration: 300-400ms | Easing: `power1.out`
```js
gsap.from(el, { opacity: 0, y: 12, duration: 0.35, ease: 'power1.out', scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' } });
```
*Framework notes: Requires the ScrollTrigger plugin registered once via gsap.registerPlugin(ScrollTrigger)*
- ✅ Keep the y offset small (8-16px) so it reads as a fade, not a slide
- ❌ Don't reveal below-the-fold content needed for SEO/crawlers as invisible-by-default without a no-JS fallback

### Avoid (Anti-patterns)
- Light mode only
- Hidden results

### Pre-Delivery Checklist
- [ ] No emojis as icons (use SVG: Heroicons/Lucide)
- [ ] cursor-pointer on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard nav
- [ ] prefers-reduced-motion respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px

