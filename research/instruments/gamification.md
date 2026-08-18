# Gamification Study (S39.11)

> Leaderboard on/off/personal/team variantlari uchun anxiety, fairness,
> motivation feedbacki segment bo'yicha olinadi.
>
> CSV: `results/raw/gamification.csv`
> Columns: `participant_id,variant,leaderboard_mode,anxiety,fairness,motivation,comment`
> (leaderboard_mode: `off`|`on_global`|`personal`|`team`)

## Modes
| Mode | Tavsif |
|------|--------|
| off | Leaderboard yo'q |
| on_global | Umumiy (barcha ishtirokchi) reyting |
| personal | Faqat o'z joyi + yaqinlari |
| team | Jamoa bo'yicha reyting |

## O'lchovlar (har mode'dan keyin)
- Anxiety (0–10): “Bu reyting sizni qanchalik asabiylashtiradi?”
- Fairness (1–7): “Reyting qanchalik adolatli?”
- Motivation (1–7): “Bu sizni qanchalik rag'batlantiradi?”
- Comment (open): “Nima sababdan?”

## Target (S39.11)
- Anxiety: on_global ≤ 5/10; personal va team mode'larida on_global'dan past
- Fairness ≥ 5.0/7 barcha mode'larda
- Motivation ≥ 4.5/7 (on_global ≥ off)

## Tahlil
- Segment bo'yicha (teacher vs student) alohida mean + CI
- Mode ichida: repeated measures / Friedman (n<20)
- Qualitative commentlar: thematic coding
