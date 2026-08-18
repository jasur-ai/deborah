# Motion Study (S39.09)

> Full / reduced / no motion variantlarida task success, perceived speed,
> discomfort solishtiriladi. OS `prefers-reduced-motion` sozlamasiga muvofiq
> variant avtomatik tanlanadi yoki moderador o'zgartiradi.
>
> CSV: `results/raw/motion.csv`
> Columns: `participant_id,variant,motion_condition,task_success,perceived_speed,discomfort`
> (motion_condition: `full` | `reduced` | `none`)

## Conditions
| Condition | Tavsif |
|-----------|--------|
| full | Barcha animatsiyalar (enter, transition, live update) |
| reduced | `prefers-reduced-motion: reduce` — faqat opacity/transform, 150ms max |
| none | Animatsiyalar butunlay o'chirilgan |

## Tasks (har condition uchun bittadan, counterbalanced)
- Task success (binary)
- Perceived speed (1–7: sekin–tez)
- Discomfort (1–7: yoqimsiz–qulay)

## Target (S39.09)
- **Success gap ≤ 10pp** (full vs none)
- Perceived speed: full ≥ reduced ≥ none (no regression)
- Discomfort: full ≤ 4.0/7

## Tahlil
- Success: McNemar (within-subject), perceived/discomfort: repeated measures ANOVA
- n < 20 → Wilcoxon signed-rank
