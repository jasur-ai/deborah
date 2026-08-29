# Research Results (STEP 39)

Bu papkada xom tadqiqot ma'lumotlari va tahlil chiqishi saqlanadi.

## CSV formatlar (raw/)

Har bir instrument o'z CSV shabloniga ega (`research/instruments/*.md` da
columns ko'rsatilgan). Field sessiyalari tugagach `raw/` ga yoziladi.

| Fayl | Instrument | Manba |
|------|-----------|-------|
| `raw/five-second.csv` | 5-second test | S39.03 |
| `raw/first-click.csv` | First-click tasks | S39.04 |
| `raw/semantic-differential.csv` | Semantic differential | S39.05 |
| `raw/visawi-s.csv` | VisAWI-S | S39.06 |
| `raw/sus.csv` | SUS | S39.06 |
| `raw/ueq.csv` | UEQ short | S39.06 |
| `raw/nasa-tlx.csv` | NASA-TLX light | S39.07 |
| `raw/fame.csv` | Fame/uniqueness | S39.08 |
| `raw/motion.csv` | Motion A/B | S39.09 |
| `raw/environment.csv` | Environment | S39.10 |
| `raw/gamification.csv` | Gamification | S39.11 |

## Anonimlashtirish
- Ishtirokchi identifikatori: `P01`, `P02`, ... — ism yozilmaydi.
- Moderatordan tashqari hech kim xom faylni ism bilan bog'lay olmaydi.

## Tahlil
```bash
node scripts/research-analyze.js --dir research/results/raw --out research/results/aggregate.json
```
Chiqish: `aggregate.json` + har target bo'yicha PASS/FAIL.

## Status
- [ ] Field sessiyalar (n≥30)
- [ ] Xom CSV lar to'ldirilgan
- [ ] `aggregate.json` generatsiya qilingan
- [ ] `../report.md` yakunlangan
