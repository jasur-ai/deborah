# Runbook: Answer-key exposure (SEV-0) 🔴

## Alomatlar
- Answer key / to'g'ri javob log, telemetry yoki bundle'da ko'rindi
- Javob ochilishi kerak bo'lmagan qismda key ko'rindi

## Darhol qadamlar
1. **Service'ni pauza qiling** — yangi session yaratishni to'xtating
2. Ekspozitsiya manbasini toping: log/telemetry/bundle — `sanitizeLog`/`assertBundleSafe` bypass'ini toping
3. **Log'larni tozalang**: key ko'rgan barcha log entry'larini aniqlang, traceId bo'yicha
4. Ekspozitsiya qilingan session'lar ro'yxatini tuzing
5. Ta'sirlangan test'lar uchun: javob kaliti o'zgartirilishi kerak (test qayta yaratiladi)
6. Fix: redaction pattern'iga test yozing (regression)

## Tekshirish
- Log secret scan: `node scripts/security-ci.js` (yoki log scan) — key'lar yo'q
- Bundle secret scan: `assertBundleSafe` — test'larda

## Eskalatsiya
- 1 soat ichida security lead + hisobot. SEV-0 — darhol.
