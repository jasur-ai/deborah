# Runbook: All participants disconnect (SEV-1)

## Alomatlar
- Barcha participant socket'lari birdan uzildi
- `connections` nolga tushdi
- Director ham uzilgan bo'lishi mumkin

## Darhol qadamlar
1. **Infrastruktura** — node/instance restart bo'ldimi? `uptime` tekshiring
2. **Redis** — Redis tushgan bo'lsa, realtime adapter single mode'ga tushganmi (`/health` → `realtime` degraded)
3. Node jonlanganida boot rehydration ishlaydi (`listCastSessions` → active timer'lar tiklanadi)
4. Participant'lar join code bilan qayta kirishadi (state event-store'da saqlangan)
5. Javoblar yo'qolganini tekshiring: `revisionDrifts` counter

## Tekshirish
- `/health` → `realtimeAdapter` — adapter holati
- Session revision hali bormi: `GET /api/cast/sessions/:id/state`

## Eskalatsiya
- 5 daqiqada tiklanmasa → SEV-0 on-call, region failover
