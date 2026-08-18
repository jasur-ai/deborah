# Edikit OWNERS — Design Scope Lock Approvals (STEP 01 / S01.12)

> Ushbu hujjat STYLE_IMPLEMENTATION_MASTER_PLAN STEP 01 talabiga binoan
> redesign scope bo'yicha mas'ul shaxslar ro'yxatini belgilaydi.

## Approval Roles

| So'ha | Mas'ul rol | Kim hal qiladi |
|-------|-----------|----------------|
| **Product** (nima quriladi) | Product owner | `jasur-ai` (repo owner) |
| **Frontend/Design** (style.md manba) | Design lead / implementation agent | `style.md` — final authority |
| **Accessibility** (WCAG 2.2 AA) | A11y rep | STEP 36 gate'da tekshiriladi |
| **Teacher** (workspace foydalanuvchisi) | Teacher rep | F4 (STEP 25–27) review |

## Scope Lock Qarori (S01.07)

Redesign scope quyidagi qatlamlar bilan cheklanadi:

1. Landing (plan_index — ✅ bajarilgan)
2. Auth (plan_login — ✅ bajarilgan)
3. Teacher Workspace + Test Builder (F4)
4. Cast visual (F5 — backend tayyor)
5. Admin (F6)
6. Error/PWA (F6)
7. Content/localization/RTL (F6)

**Chegaradan tashqari:** backend functional redesign — bu master plan UI'ga tegishli,
backend logika alohida rejalar orqali o'zgaradi.

## Approval Flow

- Har STEP yakunida: kod + test + implementation-status.md section review.
- F0–F2: implementation agent approval yetarli (o'z-o'zini tekshiruv + test).
- F3–F6: view'lar production'ga chiqishidan oldin product rep (repo owner) approval.
- F7: yakuniy launch checklist — barcha rep'lar approval.

## Kontakt

- Repo: `https://github.com/jasur-ai/edikit`
- Implementatsiya kundaligi: `implementation-status.md`
- Dizayn manba: `style.md`
