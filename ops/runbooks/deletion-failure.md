# Runbook: Deletion failure (SEV-3)

## Alomatlar
- Session/participant o'chirish xatosi (deletion-service)
- Retention job'da ma'lumot qolib ketdi

## Darhol qadamlar
1. Xato manbasini aniqlang: permission, partial delete, transaction
2. Retention job'ni qayta ishga tushiring (`scripts/backup-restore-drill.js` emas — retention job)
3. Qo'lda o'chirish: deletion-service endpoint'larini qayta chaqiring
4. Legal hold'dagi ma'lumotlar o'chirilmasligini tekshiring (data-policy pin)

## Tekshirish
- O'chirilgan session'lar qaytmayaptimi
- Retention job log'lari toza

## Eskalatsiya
- Retention buzilishi qonuniy talab bo'lsa → SEV-1, yuridik
