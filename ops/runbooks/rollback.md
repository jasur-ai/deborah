# Runbook: Rollback (SEV-1)

## Alomatlar
- Release'da regression — live session'lar buzildi
- ACK spike + error spike birga

## Darhol qadamlar
1. Qaysi release'da boshlanganini aniqlang (deploy timeline)
2. Oldingi tag/commit'ga rollback:
   ```bash
   git checkout <old-tag>
   npm ci && node server.js
   ```
3. Rollback vaqtida session'lar uziladi — rejoin qayta tiklaydi
4. Feature kill switch'lar bilan qisman rollback ham mumkin (masalan faqat `CAST_FEATURE_FORGEF=off`)

## Tekshirish
- Health yashil, ACK p95 me'yorda
- Monitoring (dashboards/cast.json) normal

## Eskalatsiya
- Rollback'da ham muammo → SEV-0, hotfix branch
