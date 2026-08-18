# Flaky Test Siyosati (AUTH D-14 §28)

**Maqsad:** Flaky test — deterministik emas, vaqt-vaqti bilan xato natija beradigan test.
Auth testlarining ishonchliligi eng muhim ustuvorlik — flaky test o'chirilmaydi, **tuzatiladi**.

## 3-chaqiriq qoidasi (3-strike rule)

1. **1-2 marta fail** — sabab aniqlanadi:
   - Test tartibiga bog'liqmi? (DB race, global state)
   - Vaqtga bog'liqmi? (real timers, `Date.now()`, setTimeout)
   - Tarmoqqa bog'liqmi? (real provider'ga chiqish)
2. **3 marta fail (ketma-ket yoki 3 xil run'da)** — test **quarantine** ga o'tkaziladi:
   - `tests/auth/quarantine/` papkasiga ko'chiriladi (CI'da ishlamaydi)
   - `# TODO(flaky): <sabab>` izohi bilan belgilanadi
3. **Sabab tuzatiladi** — o'chirish EMAS:
   - Root cause topiladi (determinizm buzilishi)
   - Fix yoziladi (mock clock, fresh DB, izolyatsiya)
   - Test quarantine'dan qaytariladi va 3 marta ketma-ket yashil bo'lishi tekshiriladi

## YO'Q bo'lgan amaliyotlar

- ❌ `test.skip()` bilan yashirish (sababsiz)
- ❌ `it.todo()` ga aylantirish (sababsiz)
- ❌ Timeout'ni cheksiz oshirish (100s+) — simptomni yashiradi
- ❌ Real provider'ga ulanish (D-14 §13)

## Determinizm qoidalari (D-14 §11)

| Manba | Yechim |
|---|---|
| Vaqt | `vi.useFakeTimers()` yoki `tests/helpers/setup.js` `setTestTime/advanceTime` |
| Random | `tests/helpers/mock-providers.js` `spyRandomInt` (deterministik kodlar) |
| Tarmoq | Mock provider: OIDC JWKS, email mock, Turnstile/HIBP fetch mock |
| DB | `LOCAL_DB_FILE` (vitest config — per-invocation temp fayl) + `snapshotDb/restoreDb` |
| Redis | ioredis-mock, har test fresh namespace (D-14 §12) |
| Global state | `vi.resetModules()` + `vi.restoreAllMocks()` + `vi.unstubAllGlobals()` |

## Jarayon

1. Flaky aniqlanganda — `Status.md` ga yoziladi (qaysi test, necha marta fail).
2. Kim topsa o'sha tuzatadi; tuzatolmasa — boshqa agentga so'rov yuboradi (bridge).
3. Tuzatilgan test **3 marta ketma-ket** `npm run test:auth` bilan tekshiriladi.
4. Quarantine'dagi testlar haqida hisobot `implementation-status-auth.md` da saqlanadi.
