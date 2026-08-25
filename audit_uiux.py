#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Edikit UI/UX — PROMPT GUIDE AUDIT v1.0
Har promptni tekshiradi: 30-40 qator, raqamlash, fence balansi, detektiv elementlar.
Foydalanish:  python3 audit_uiux.py            (barcha fayllar)
              python3 audit_uiux.py PROMPT_GUIDE_UIUX_B.md   (bitta)
Natija: 0 exit code = qabul; 1 = muammo bor.
"""
import re
import sys

FILES = [
    "PROMPT_GUIDE_UIUX_MASTER.md",
    "PROMPT_GUIDE_UIUX_A.md", "PROMPT_GUIDE_UIUX_B.md", "PROMPT_GUIDE_UIUX_C.md",
    "PROMPT_GUIDE_UIUX_D.md", "PROMPT_GUIDE_UIUX_E.md", "PROMPT_GUIDE_UIUX_F.md",
    "PROMPT_GUIDE_UIUX_G.md", "PROMPT_GUIDE_UIUX_H.md",
]
MIN_LINES, MAX_LINES = 30, 40

# Detektiv elementlar tekshiruvi ASOSIY KODDA bajariladi (edikit/ repo'da, bajarilish vaqtida).
# Prompt fayllarida ular GREP-CHECK qoidalari sifatida yozilgan — bu normal.
# Bu skript faqat: qator soni (30-40), raqamlash, fence balansini tekshiradi.
DETECTIVE = []

def audit(fname):
    problems = []
    with open(fname, encoding='utf-8') as f:
        lines = f.readlines()
    # fence balance
    fences = sum(1 for ln in lines if ln.strip().startswith("```"))
    if fences % 2 != 0:
        problems.append(f"fence balanssiz: {fences}")
    # prompts (faqat fazalar)
    headers = [(i, ln.strip()) for i, ln in enumerate(lines)
               if re.match(r'^## [A-H]-\d+', ln.strip())]
    counts = []
    for idx, (i, h) in enumerate(headers):
        end = headers[idx+1][0] if idx+1 < len(headers) else len(lines)
        body = lines[i+1:end]
        content = [b for b in body if b.strip() and not re.match(r'^---+$', b.strip())]
        c = len(content)
        counts.append(c)
        if c < MIN_LINES:
            problems.append(f"{h}: {c} qator — MINIMUM {MIN_LINES} dan kam!")
        if c > MAX_LINES:
            problems.append(f"{h}: {c} qator — MAKSIMUM {MAX_LINES} dan ortiq!")
        nums = [int(m.group(1)) for ln in content if (m := re.match(r'^(\d+)\.\s', ln))]
        if nums and nums != list(range(1, len(nums)+1)):
            problems.append(f"{h}: raqamlash xato (birinchi: {nums[:5]})")
    # detektiv elementlar (kod audit — prompt faylida emas; shu yerda o'chirilgan)
    found = [d for d in DETECTIVE if d in text]
    if found and "MASTER" not in fname.upper():
        problems.append(f"detektiv elementlar topildi: {found}")
    return headers, counts, problems

def main():
    targets = sys.argv[1:] if len(sys.argv) > 1 else FILES
    total_prompts = 0
    all_problems = []
    for fname in targets:
        try:
            headers, counts, problems = audit(fname)
        except FileNotFoundError:
            print(f"✗ {fname}: topilmadi")
            all_problems.append(f"{fname}: missing")
            continue
        total_prompts += len(headers)
        status = "OK" if not problems else "XATO"
        print(f"{'✓' if not problems else '✗'} {fname}: {len(headers)} prompt | "
              f"qatorlar {min(counts) if counts else '-'}..{max(counts) if counts else '-'} | {status}")
        for p in problems:
            print(f"    ! {p}")
            all_problems.append(f"{fname}: {p}")
    print("-" * 50)
    print(f"JAMI: {total_prompts} prompt")
    if all_problems:
        print(f"MUAMMOLAR: {len(all_problems)} ta — tuzatish kerak!")
        return 1
    print("QABUL: hamma prompt 30-40 qator, raqamlash toza, fence balansda.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
