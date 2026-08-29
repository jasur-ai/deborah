# Runbook: Join raid (SEV-2)

## Alomatlar
- Bir zumda yuzlab join — connection soni keskin o'sdi
- ACK p99 o'smoqda, `connections` spike

## Darhol qadamlar
1. Backpressure admission queue ishlayapti (katta lobby blok) — kutib turing
2. `LOCK_LOBBY` command — lobby'ni yopib qo'ying (o'qituvchi boshqaradi)
3. Yopiq lobby'da yangi join'lar rad etiladi
4. Join raid'ni bot'lar qilgan bo'lsa — `BLOCK_PARTICIPANT` ishlating
5. Monitoring: `connections` counter normal holatga qaytdimi

## Tekshirish
- P0 (join) hech qachon drop bo'lmaydi — accepted join'lar saqlangan
- `/health` backpressure normal holatda

## Eskalatsiya
- Bot hujumi davom etsa → SEV-1, WAF/rate-limit kuchaytirish
