# Runbook: Host disconnect (SEV-2)

## Alomatlar
- Director sahifa uzildi, participant'lar "Direktor uzildi" ko'rmoqda
- `connections` counter tushdi, `rejoin` kutilganidan kam

## Darhol qadamlar
1. Host socket qayta ulanayotganini tekshiring: `curl /health` → `realtime` statusi
2. 30 soniya kuting — session avtomatik rejoin qiladi (connection recovery)
3. Rejoin bo'lmasa: host'ga yangi tabda director URL berib yuboring
4. Session state saqlanadi (event-store) — hech narsa yo'qolmaydi

## Tekshirish
- `GET /api/cast/sessions/:id/state` — revision o'sayaptimi
- Log'larda `cast:rejoin` traceId bormi

## Eskalatsiya
- 2 daqiqada rejoin bo'lmasa → SEV-1, on-call
