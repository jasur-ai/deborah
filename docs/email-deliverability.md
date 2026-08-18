# Email Deliverability (AUTH A-23)

Deborah **faqat transactional** email yuboradi (welcome, verify, reset, teacher_approved/rejected).
Marketing email **alohida tizim** — bu sender domain'ning reputatsiyasini himoya qiladi
(SPF/DKIM/DMARC samaradorligi uchun eng muhim qoida).

## Provider tanlash

| | Postmark | SES |
|---|---|---|
| Foydalanish | Transactional-only, ~93% inbox | Arzon, self-managed |
| Xarajat | $/1000 (100k/oy gacha bepul) | $0.10/1000 (birinchisi bepul) |
| DevOps | Kam — webhook'lar tayyor | Ko'proq — bounce SNS'ga bog'lash kerak |
| Tavsiya | **Boshlash uchun** | Hajm katta bo'lsa |

## `.env` konfiguratsiya

```bash
# Provider: mock | smtp | postmark  (test'da har doim mock)
EMAIL_PROVIDER=postmark
POSTMARK_SERVER_TOKEN=xxxxx
MAIL_FROM=Deborah <no-reply@deborah.uz>
MAIL_SENDING_DOMAIN=mail.deborah.uz
# Webhook token (Postmark: X-Postmark-Webhook-Token)
EMAIL_WEBHOOK_TOKEN=xxxxx

# SMTP variant:
# EMAIL_PROVIDER=smtp
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=...
# SMTP_PASS=...
```

Kredensiallar **faqat server'da** (env). Frontend'ga hech qachon chiqmaydi.
Production'da KMS/secret manager'da saqlanadi.

## DNS record'lar (dedicated sending domain: `mail.deborah.uz`)

> Bosh domain `deborah.uz`'ning SPF'iga faqat MX qo'yiladi; yuborish **`mail.deborah.uz`**
> subdomain'idan — reputatsiya izolyatsiyasi.

### 1. SPF (TXT)
```
mail.deborah.uz  TXT  "v=spf1 include:spf.postmarkapp.com ~all"
```
> `~all` (softfail) — xatolarni ko'rish uchun. 2 haftadan keyin `-all` (hardfail).

### 2. DKIM (TXT)
Postmark server sozlamalaridan DNS record'ni ko'chiring (har providerda boshqacha):
```
pmmail._domainkey.mail.deborah.uz  TXT  "k=rsa; p=MIGfMA0GCSq...postmark provider beradi"
```

### 3. DMARC (TXT)
```
_dmarc.mail.deborah.uz  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@deborah.uz"
```
Bosqichma-bosqich:
1. `p=none` + monitoring (2-4 hafta) — DMARC report'lar bilan taxlil
2. `p=quarantine` (2 hafta)
3. `p=reject` — DMARC report monitoring davom etadi

### 4. Return-Path / MX
Postmark o'z bounce domain'ini beradi (`pm-bounces.mail.deborah.uz`) — DNS'ga qo'shing.

## Bounce/complaint webhook

- Endpoint: `POST /api/webhooks/email`
- Himoya: `X-Postmark-Webhook-Token` == `EMAIL_WEBHOOK_TOKEN` (production'da **majburiy**)
- **Hard bounce** → `users/{userKey}/email_status='bounced'` — keyingi yuborishlar suppress
- **Complaint** → audit `email:complaint` (threshold <0.1% — Google/Yahoo talabi)
- Idempotent: `email_log/{messageId}` — takroriy webhook ikkinchi marta ishlanmaydi
- Audit: `email:bounced`, `email:complaint`, `email:suppressed`

## Email validation (signup'da)

Register'da: syntax (Zod) + **disposable blok** (hard) + **MX tekshiruvi** (200ms budget).
- Disposable (temp-mail) → `emailDisposable` xato, user yaratilmaydi
- MX yo'q (domain'da mail server yo'q) → `emailInvalid`
- MX natijasi 24 soat cache — takroriy so'rovlar DNS'ga chiqmaydi
- Test'da MX skip (fail-open) — CI'da tarmoqqa chiqmaydi

## Retry/backoff

Provider'ga yuborish muvaffaqiyatsiz bo'lsa: **3 marta** (1s / 3s / 9s).
Webhook'lar idempotent — takroriy yetkazish xavfsiz.

## Template'lar (spam trigger yo'q)

`src/modules/email/templates.js` — 5 template × 4 til (uz, uz-cyrl, ru, en):
`verify`, `reset`, `welcome`, `teacher_approved`, `teacher_rejected`.

Qoidalar: ALL CAPS yo'q, "FREE"/"URGENT"/"!!!" yo'q, plain-text versiya majburiy,
preheader har doim. `scanSpamTriggers()` test'larda tekshiradi.
