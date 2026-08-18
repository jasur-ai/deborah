# Design Token Migration Map (S04.12)

Final Edikit Cobalt/Signal/Insight qiymatlari `to_do/style.md` (46-bo'lim,
light hierarchy + final palette) dan olindi va `public/design/tokens/`
da DTCG formatida reference qilindi.

## Brand final → legacy draft map

| Final token (source) | Qiymat | Legacy draft (`--accent*`) | Izoh |
|----------------------|--------|----------------------------|------|
| `edikit.primitive.cobalt.cobalt-500` | `#2256D8` | `--accent: #3B82F6` (dark) / `#2563EB` (light) | Draft action blue → **Edikit Cobalt** |
| `edikit.primitive.cobalt.cobalt-600` | `#1746D1` | `--accent-dark: #2563EB` | Hover |
| `edikit.primitive.cobalt.cobalt-700` | `#1739B7` | `--accent-deep: #1D4ED8` | Active |
| `edikit.primitive.signal.signal-light` | `#007C91` | — (yangi) | Signal Cyan |
| `edikit.primitive.insight.insight-light` | `#9B5E00` | `--accent-amber: #D97706` | Insight Amber |
| `edikit.primitive.foundation.ink` | `#0C1426` | `--bg-deep: #050914` | Ink |
| `edikit.primitive.foundation.paper` | `#F6F8FC` | — (yangi) | Paper |

## Semantic backward aliases (S04.08 — generated CSS)

`public/design/generated/tokens.css` oxirida:

```css
:root {
  --accent: var(--edikit-semantic-color-action-primary);
  --bg:     var(--edikit-semantic-color-surface-default);
  --card:   var(--edikit-semantic-color-surface-raised);
  --text:   var(--edikit-semantic-color-text-primary);
  --muted:  var(--edikit-semantic-color-text-muted);
}
```

⚠️ **DEPRECATED** — yangi code `--edikit-semantic-*` ishlatishi kerak.
`--bg`, `--card`, `--text`, `--muted`, `--accent` faqat backward compat
uchun.

## Migration bosqichlari

1. **STEP 04 (hozir)** — token source + validator + build; legacy alias
   generated CSS'da mavjud; hech qanday view o'zgartirilmaydi.
2. **Keyingi STEP'lar** — `style.css` `:root` bloklari asta-sekin
   `@import` / `--edikit-*` ga ko'chiriladi; raw hex'lar semantic token
   bilan almashtiriladi (STEP 04 → 12 oraliqda).
3. **Yakuniy** — component CSS'da `--accent*` / `--bg*` to'liq semantic
   aliasga o'tadi; legacy alias'lar o'chiriladi.

## Raw hex source'lar (STEP 01 scan)

`design-audit/baseline-scan.md` — 57 faylda 113 raw hex (style.css).
Har biri quyidagi tartibda almashtiriladi:
`raw hex → edikit.primitive → edikit.semantic.<theme> → --edikit-semantic-*`
