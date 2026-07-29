# Edikit — Architecture Document

## 📊 Architecture Comparison

### Edikit Architecture (Current)
```
server.js                    → Express + Socket.io + all middleware
├── routes/                  → Route handlers (modular) — all business logic
├── middleware/              → Auth + error handling
├── socket/                  → Socket.io handlers
├── utils/                   → Icons + constants + helpers
├── public/css/              → style.css (design system) + admin.css
├── public/js/               → main.js + theme.js (only loaded files)
├── views/                   → 20+ EJS views
├── firebase/                → Local DB + seed data
└── scripts/                 → Dev, test, seed, build scripts
```

## 🎯 Key Improvements

### 1. ✅ Cleaned Dead Code
- Removed 7 dead JS files (panel.js, game.js, player.js, admin.js, create-test.js, arena.js, index.js) that were never loaded by any EJS template
- Removed 3 dead CSS files (main.css, game.css, panel.css) — only style.css and admin.css are used
- Removed decorative design-tokens/ directory (JSON files not consumed by any code)
- Removed empty controllers/ and services/ directories

### 2. ✅ SVG Icon System
- `utils/icons.js` — 40+ professional SVG icons
- `window.__ICONS` injection for client-side use
- `icon()` EJS helper + `svgIcon()` client helper

### 3. ✅ Professional Logo System
- `logo-icon.svg` — Hexagon + lightning
- `logo-text.svg` — Full text with icon + subtitle
- Favicon, PWA-ready images

### 4. ✅ Modular Middleware
- `middleware/auth.js` — Auth + locals + icons
- `middleware/error.js` — 404 + error handlers

### 5. ✅ Clean Scripts
- `scripts/mock-up.js` → Socket.io-based bot simulator (real-time)
- `scripts/seed-dev.js` → Development seed data
- `scripts/build-og-image.js` → OG image generation
- `scripts/build-pwa-icons.js` → PWA icon generation

## 🔄 Architecture

### Socket.io Real-time Game Engine
```
Client (enter.ejs) → socket.emit('player:answer') → Server processes → socket.emit('answer:count') → Client (host.ejs)
Client (arena)     → socket.emit('arena:botAnswer') → Server processes → socket.emit('answer:count') → Client (host.ejs)
```

### Arena Architecture
```
/arena (public route, no auth)
├── views/user/test-arena.ejs     → Split-screen: host iframe (left) + phone device (right)
├── socket events:
│   ├── arena:watch               → Watch game state
│   ├── arena:botAnswer           → Simulated bot answers → real-time host updates
│   └── arena:leave               → Clean up on exit
└── API endpoints:
    ├── /arena/api/check-session  → Check if game code exists
    ├── /arena/api/add-bots       → Add N bots to session
    └── /arena/api/cleanup-bots   → Remove all bots
```

## 📁 Directory Structure

```
edikit/
├── server.js                    ← Express + Socket.io server
├── routes/                      ← Route handlers (all logic lives here)
│   ├── index.js                 → Landing page
│   ├── auth.js                  → Login/register
│   ├── admin.js                 → Admin panel
│   ├── user.js                  → User panel, tests
│   ├── game.js                  → Host/play routes
│   └── arena.js                 → Test arena (public)
├── middleware/                   ← Auth, error, CSRF
├── socket/                      ← Socket.io game handlers
│   └── game-handler.js          → All real-time events
├── utils/                       ← Icons, helpers, constants
├── public/
│   ├── css/                     → style.css (design system) + admin.css
│   ├── js/                      → main.js + theme.js (only 2 files)
│   └── images/                  ← Logos, characters
├── views/                       ← EJS templates
├── firebase/                    ← Local DB + seed
└── scripts/                     ← Dev, test, seed, build
```

> Document version: 2.1 | Last updated: July 2026 | Cleaned: removed dead CSS, design-tokens, controllers, services
