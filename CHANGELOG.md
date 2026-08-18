# Edikit Changelog

Barcha muhim o'zgarishlar (design, aksessuarlik, performance, platforma) shu yerda qayd etiladi.
Format: [Keep a Changelog](https://keepachangelog.com/) asosida.

## [Unreleased]

## [2.1.0] — 2026-08-09 — Design Launch (STYLE 1–41)

### Added
- **Evidence-Led Institutional brand**: Evidence Mark (rail + 3 ticks + node), wordmark
  variantlari (horizontal/compact), monochrome/inverse/high-contrast — `public/images/brand/`
- **Design token system (DTCG)**: primitive → semantic → component, light/dark/high-contrast
  theme parity, `scripts/validate-design-tokens.js` + generated CSS
- **Component library**: button/icon-button/badge, forms, selection, overlays, feedback,
  navigation, tables, charts, empty states — `public/design/components/`
- **Context pages**: teacher workspace, test library/builder, Cast Setup, Director/Projector/
  Participant cockpits, admin redesign, error/PWA offline
- **Feature flags** (S40): `utils/feature-flags.js` — 6 kontekst, session-stable cookie
- **Gates**: design lint (S37), perf budget (S38), legacy usage trend (S40),
  a11y axe suite, visual regression matrix, user research kit (S39)
- **Governance**: `docs/design-system/governance.md`, `CODEOWNERS`, quarterly audit policy

### Changed
- Legacy `public/css/style.css` accent override'lariga qaramay, semantic token'lar authority
- Landing — product-led, evidence-driven; light gray haze yo'q
- Cast gamification — mature: public low-rank shame yo'q, optional leaderboard

### Deprecated
- Legacy variable aliases (`--accent`, `--bg`, `--text`, ...) — `legacy:usage` baseline **1375**
  (CSS 328 + views 1047); cleanup release'da olib tashlanadi (S40.12)

### Removed
- (Yangi release'da olinadiganlar S40.12 cleanup'da ko'rsatiladi)

### Security & Reliability
- WCAG 2.2 AA + COGA gate'lar (axe serious/critical 0)
- CWV budgets: LCP ≤2.5s, INP ≤200ms, CLS ≤0.1; landing CSS ≤35KB gzip
- 41 step'lik STYLE implementation acceptance (implementation-status.md)

---

[2.1.0]: https://github.com/edikit/edikit/releases/tag/v2.1.0
