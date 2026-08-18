# Auth Recovery Runbook (AUTH C-15)

> Auth-critical ma'lumotlar yo'qolishi / korrupsiyasi / regional falokat holatida
> qayta tiklash bo'yicha qadamlar. DR targets: **RPO ≤ 1 soat, RTO ≤ 4 soat**.

## 1. Kim, qachon

| Rol | Mas'uliyat |
|---|---|
| On-call (SRE/DevOps) | Hodisani aniqlaydi, runbook'ni boshlaydi, 15 daqiqa ichida RTO hisobini boshlaydi |
| Auth owner (senior dev) | Restore'ni tasdiqlaydi, MFA/password hash integrity tekshiradi, sign-off beradi |
| Ikkinchi operator | Restore natijasini mustaqil tekshiradi (2 kishi qoidasi — backup access minimal) |
| DRI (Incident Commander) | RTO 4 soat chegarasini kuzatadi, eskalatsiya (agar 2 soatdan oshsa) |

## 2. Backup lokatsiyalari

| Data | Manba | Nusxa |
|---|---|---|
| Auth jadvallari (users, credentials, audit, MFA) | local JSON DB (fb) | `data/backups/auth/auth-*.bak.enc` — **AES-256-GCM shifrlangan**, 30 kun retention |
| PostgreSQL (auth jadvallari PG rejimida) | PG | PITR: daily full + hourly WAL (reliability `pg-pitr`) |
| Redis (session, rate-limit) | Redis | RDB snapshot + AOF; **asosiy emas** — session yo'qolsa foydalanuvchi qayta login qiladi |
| KMS secrets | KMS (D-02) | **Backup qilinmaydi** — KMS provider redundancy |

## 3. Restore qadamlar (auth critical)

### 3.1 Diagnostika (5 daqiqa)
1. Hodisani tasdiqlang: login 500, `auth_audit` yozilmayapti, `users` korrupsiya.
2. Eng so'nggi backup'ni toping: `node -e "import('./src/modules/auth/backup.js').then(m => console.log(m.latestBackupInfo()))"`.
3. Backup yoshi `RPO ≤ 1 soat` ekanini tekshiring (agar 1 soatdan katta — ma'lumot yo'qotish e'lon qiling, RPO hisobiga).

### 3.2 Restore (15-30 daqiqa)
```bash
# 1) Serverni to'xtating (yozuvlar to'xtashi shart)
pm2 stop deborah  # yoki systemctl stop deborah

# 2) Joriy buzilgan holatni arxivlab qo'ying (rollback uchun)
cp -r data/db.json data/db.json.corrupt-$(date +%s)

# 3) Restore drill script (faqat TEST muhitida — production'da operator qo'lda):
NODE_ENV=test SESSION_SECRET=... node -e "
  import('./src/modules/auth/backup.js').then(async (m) => {
    const r = await m.restoreAuthBackup(process.argv[1]);
    console.log('restore', r);
  });
" data/backups/auth/auth-<eng-so'nggi>.bak.enc

# 4) Restore verify — login, session, MFA, parol hash integrity:
#    integration test: tests/integration/auth-backup-c15.test.js
```

### 3.3 Verify (30 daqiqa)
1. **Login**: mavjud foydalanuvchi login qila oladi (parol hash integrity).
2. **Session**: yangi session yaratiladi; eski session invalid (Redis tozalandi — re-login).
3. **MFA**: TOTP enrol qilingan user kodi bilan kira oladi (`mfa_totp` restore'da).
4. **Audit**: `auth:restore:drill` + `auth:restore:verify` yozuvlari bor.
5. **Data integrity**: backup checksum (sha256) tasdiqlangan.

### 3.4 Qayta ishga tushirish
```bash
pm2 start deborah
curl -s http://localhost:<port>/health   # 200
curl -s http://localhost:<port>/user/login  # 200
```

## 4. Rollback rejasi
- Restore muvaffaqiyatsiz bo'lsa: `db.json.corrupt-*` dan eski holatga qayting, avvalgi backup'ni sinab ko'ring.
- Restore yarim muvaffaqiyatli (ba'zi collection yo'q): faqat o'sha collection'ni qayta restore qiling (idempotent — fb.set).
- Redis'da hech narsa restore qilinmaydi (session/rate-limit — re-login kifoya).

## 5. Muntazam drill (har oy)
```bash
node scripts/backup-restore-drill.js --all
```
Har oy test muhitida to'liq drill: fresh DB → restore → login/session/MFA verify → sign-off.
`recordBackupRestore` audit + metric yozadi (`deborah_reliability_backup_restores_total`).

## 6. Observability
- `latestBackupInfo().ageMs` — backup_age gauge (D-06 alert: > 26 soat → warning, > 50 soat → page).
- `auth:backup:failed` audit — har qanday backup xatosi ops'ga ko'rinadi.
- `restore_drill_count` — har oylik drill metrikasi.
