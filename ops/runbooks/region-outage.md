# Runbook: Region outage (SEV-1)

## Alomatlar
- Barcha node'lar bir region'da — region tushdi
- DNS sinib qoldi, barcha session'lar uzildi

## Darhol qadamlar
1. Boshqa region'da node'lar borligini tekshiring (`/health` — turli regionlar)
2. DNS failover — traffic'ni tirik region'ga yo'naltiring
3. Node'lar qaytganida boot rehydration active session'lar/timer'larni tiklaydi
4. Session state event-store'da — join code bilan davom etish mumkin
5. Session'lar davom etmaydigan bo'lsa — o'qituvchilarga yangi session ochishni tavsiya qiling

## Tekshirish
- `/health` turli regionlarda
- Session revision'lar tiklandimi

## Eskalatsiya
- Multi-region yozilmagan bo'lsa → SEV-0, infra redesign
