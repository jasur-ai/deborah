# 5-Second Test (S39.03)

> Ishtirokchiga variant **5 soniya** ko'rsatiladi, so'ng yopiladi.
> Savollar og'zaki (moderator yozadi):
>
> CSV: `results/raw/five-second.csv`
> Columns: `participant_id,variant,what,who,value,cta,category_correct,cta_correct`
> - `what/who/value/cta`: moderator quoted verbatim yoki "no recall" yozadi
> - `category_correct`, `cta_correct`: sessiyadan keyin **coder binary kodlaydi**
>   (0/1) — S39.03 analysis bo'limiga muvofiq. Parser aynan shu ikki maydonni o'qiydi.

## Savollar
1. **What** — “Bu nima ekanligini aytib bering?” (product category)
   - Success: platform/sinov/test o'tkazish vositasi haqida gap
2. **Who** — “Bu kim uchun ekanini aytib bering?” (audience)
   - Success: teacher/student/o'qituvchi/ta'lim sohasi
3. **Value** — “Uning asosiy qiymati nima deb o'ylaysiz?”
   - Success: realtaimedan birortasi (jonli nazorat, tahlil, samarali test)
4. **CTA** — “Nima bosishni xohlaysiz / qanday harakat qilasiz?”
   - Success: primary CTA (boshlash/ro'yxatdan o'tish) ni eslash

## Target (S39.03)
- **Category recall ≥ 80%** (what + who correct)
- CTA recall ≥ 60%

## Tahlil
- Har bir recall: binary (0/1) → % + CI
- Variant A vs C/D: chi-square (Fisher exact, n kichik bo'lsa)
