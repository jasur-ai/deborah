# Runbook: Personal-data incident (SEV-0) 🔴

## Alomatlar
- Student PII (ism, email, raw open text) log/telemetry/bundle'da ko'rindi
- Roster bundle'da chiqdi

## Darhol qadamlar
1. **Service'ni pauza qiling**
2. Manbani toping: `sanitizeLog`'da qaysi pattern o'tkazib yuborgan — fix
3. Log'larni tozalang — PII ko'rgan entry'lar traceId bo'yicha
4. Ta'sirlangan foydalanuvchilar ro'yxatini tuzing (faqat internal)
5. Xavfsizlik hisoboti — GDPR/qonun talabi bo'yicha
6. Regression test: PII hech qachon telemetry/bundle'ga tushmasligi

## Tekshirish
- Log secret scan + bundle secret scan
- `assertBundleSafe` — roster/raw/name pattern'lar qamrab olganmi

## Eskalatsiya
- 1 soat ichida security lead + yuridik. SEV-0 — darhol.
