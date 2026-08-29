# Deborah — Feature Modules

Each feature module encapsulates a bounded context of the application.

## Module structure

```
src/modules/<feature>/
  index.ts          → Public API (exports)
  service.ts        → Business logic
  types.ts          → Feature-specific types
  middleware.ts     → Feature-specific Express middleware
  validators.ts     → Zod schemas for this module
```

## Existing feature domains (not yet modularized)

- `auth` — User/admin login, registration, session management
- `quiz` — Test creation, editing, taking, scoring
- `arena` — Split-screen game arena, host, player, bots
- `admin` — Admin dashboard, user mgmt, VIP, fans, stats
- `search` — Public test search

## Dependency rules

1. Modules may import from `@contracts/*`, `@infrastructure/*`, `@config/*`
2. Modules MUST NOT import from `routes/`, `middleware/`, `utils/`, `firebase/` directly
3. Cross-module imports go through a shared contract in `@contracts/`
4. Every module has a single public entrypoint (`index.ts`)
