# Deborah — Architecture Document

## 📊 Architecture Comparison

### Deborah Architecture (Current)
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
deborah/
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

## 🔒 VIP Access Control

### Overview
VIP tizimi — bu **yashirin premium** funksiya. Oddiy foydalanuvchi bu funksiya mavjudligini
**umuman bilmasligi** kerak. Hech qanday UI, matn, yoki HTML komment VIP borligini
ko'rsatmasligi kerak.

### Data Model

```
users/{safeKey}/isVip             → boolean (default: false)
users/{safeKey}/vipGrantedAt      → timestamp | null
users/{safeKey}/vipGrantedBy      → string (admin username) | null
users/{safeKey}/vipRevokedAt      → timestamp | null
users/{safeKey}/vipPlainPassword  → string | null (faqat admin ko'radi)
```

### Why 404 (not 403)?

| Status code | Meaning | Issue |
|-------------|---------|-------|
| **403 Forbidden** | "Bu yerda nimadir bor, lekin sizga ruxsat yo'q" | Yashirin funksiya mavjudligini bildirib qo'yadi |
| **404 Not Found** | "Bunday sahifa umuman yo'q" | Oddiy foydalanuvchi noto'g'ri URL yozgandek taassurot qoldiradi |

⚠️ **Muhim**: Hech qachon 403 qaytarmang — bu "VIP bo'lim" borligini ochib beradi.

### Architecture

```
┌─ ADMIN PANEL ──────────────────────────────────────┐
│  routes/admin.js                                    │
│  ├── GET  /admin/vip              → VIP sahifasi    │
│  ├── GET  /admin/api/users        → Users list + VIP │
│  ├── POST /admin/api/vip/grant    → VIP berish      │
│  └── POST /admin/api/vip/revoke   → VIP olib tashlash│
│                                                     │
│  ⚠️ Grant: password maydoniga TEGILMAYDI —          │
│     user o'z paroli bilan kiraveradi.               │
└─────────────────────────────────────────────────────┘

┌─ ACCESS CONTROL ────────────────────────────────────┐
│  middleware/vip.js                                   │
│  ├── requireVip(req, res, next)                      │
│  │   ├── DB dan isVip ni o'qi (har safar, keshlanma)│
│  │   ├── true  → next()                              │
│  │   └── false → 404 render('error')                 │
│  └── isCurrentUserVip(req) → boolean                 │
│                                                       │
│  routes/game.js:                                      │
│    GET /host?source=mock|pre → vipGateForMockPre     │
│    (requireVip middleware applied conditionally)      │
└─────────────────────────────────────────────────────┘

┌─ UI HIDING (USER PANEL) ────────────────────────────┐
│  routes/user.js                                      │
│  └── /panel                                          │
│      ├── isVip=true  → fans/pre data loaded + sent  │
│      └── isVip=false → fans={}, pre={} (empty)      │
│                                                       │
│  views/user/panel.ejs                                 │
│  └── Mock section: <% if (isVip && fans.length) { %> │
│  └── PRE section:  <% if (isVip && preGroups) { %>  │
│                                                       │
│  ℹ️ Both sections are 100% server-gated:              │
│     - Ma'lumot serverdan chiqmaydi                   │
│     - HTML rendering qilinmaydi                      │
│     - View Source da ham ko'rinmaydi                 │
└─────────────────────────────────────────────────────┘
```

### Auto-Migration

`firebase/local-db.js` → `LocalDB.init()`:
- Server ishga tushganda barcha userlarni tekshiradi
- `isVip === undefined` bo'lganlarga `isVip: false` qo'shadi
- **Idempotent**: keyingi safar hech narsa qilmaydi

```js
// Auto-migration in init():
const users = this._data.users;
if (users && typeof users === 'object') {
  let migrated = 0;
  for (const userKey of Object.keys(users)) {
    const user = users[userKey];
    if (user && typeof user === 'object' && user.isVip === undefined) {
      user.isVip = false;
      user.vipGrantedAt = null;
      user.vipGrantedBy = null;
      user.vipRevokedAt = null;
      user.vipPlainPassword = null;
      migrated++;
    }
  }
  if (migrated > 0) {
    await writeDB(this._data);
    console.log(`🔄 Migratsiya: ${migrated} ta foydalanuvchiga isVip maydoni qo'shildi`);
  }
}
```

### Seed Data (VIP Demo Users)

`firebase/seed-data.js`:
```
3 ta demo VIP user:
  - sardor  | isVip: true | parol: 1234
  - feruza  | isVip: true | parol: 1234
  - shoxrux | isVip: true | parol: 1234

Qolgan 46 ta user: isVip: false (automigration qo'shadi)
```

### Security Rules

| Rule | Enforced at |
|------|-------------|
| `safeKey()` username sanitization | `routes/admin.js` grant/revoke |
| `requireAdmin` router-level | `routes/admin.js` → `router.use(requireAdmin)` |
| 404 (not 403) for non-VIP | `middleware/vip.js` → `requireVip` |
| DB read every request (no cache) | `middleware/vip.js` → `fb.get(.../isVip)` |
| Password NOT overwritten on grant | `routes/admin.js` → only sets isVip, vipPlainPassword |
| `<%= %>` EJS escaping in views | `views/admin/vip.ejs` — all username outputs |
| `esc()` client-side function | `views/admin/vip.ejs` — JS template literals |
| No HTML comments leaking VIP | `views/user/panel.ejs` — comments removed |

### Test Coverage

| Script | Tests | Coverage |
|--------|-------|----------|
| `scripts/test-vip-browser.js` | 15 | Login, grant, VIP panel, non-VIP hiding, 404 |
| `scripts/test-xss.js` (sec 7-10) | 22 | safeKey, ESM import, 404, escaping, HTTP XSS |

> Document version: 2.2 | Last updated: July 2026 | Added: VIP Access Control, Auto-migration, Security Rules
