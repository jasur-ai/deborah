# Edikit AI QATLAMI — DEEP RESEARCH (nol xarajat, UZ uchun, yuqori sifat)

> **Holat:** research bosqichi. Maqsad: Edikit'ga AI qayerda qo'shiladi, O'zbekiston uchun eng yaxshisi, **nol xarajat** (self-host yoki bepul usullar), sifat zo'r bo'lishi. Real manbalar: web maqolalar + GitHub API + edikit repo kodi.
> **Asosiy xulosa (1 jumla):** Edikit'da AI pipeline **allaqachon bor** (ai-question-gen, ai-grading, claude adapter, ai-mlops — repo o'qildi); yo'q narsa — **bepul provider qatlami**. Yechim: **self-hosted Qwen3 8B/14B (Ollama/vLLM) + pgvector RAG (ular allaqachon PostgreSQL'da) + Groq/Gemini bepul tier'lar (failover)** — bular $0 va sifat yetarli; fine-tune faqat kerak bo'lsa Unsloth+Colab ($0).
> **Muhim cheklov:** O'zbekiston data law + Global Master qoidalari — talaba PII **UZ'da qolishi shart**. Shuning uchun self-host asosiy, tashqi API faqat anonim/umumiy kontent uchun va "training yo'q" kafolati bo'lganlar (Groq) bilan.

---

## 1. EDIKIT'DA AI QAYERDA KERAK (repo kodi bilan)

Repo'da `src/modules/` da AI modullari BOR (tekshirildi):
```
ai-question-gen/  ai-grading/  ai-checkpoint/  ai-mlops/
claude/  resource-reco/
canva/  google-slides/  deck-export/  presentation/
```

**ai-question-gen kodi o'qildi — nima allaqachon tayyor:**
- **Blueprint + 50/30/20** (easy 50% / medium 30% / hard 20%)
- **Overgenerate 3-5** (har slot uchun ortiqcha generatsiya → keyin tanlash)
- **Validators** (runAllValidators — savol sifat tekshiruvi)
- **Lifecycle guard:** candidate APPROVED bo'lmaydi teacher review'siz (human-in-loop kodda)
- **Audit + tenant-scope + idempotent** (UNIQUE index)
- **Publish:** APPROVED → item-bank (source: ai_generated)

**claude.client kodi o'qildi — nima tayyor:**
- Fetch-based Messages API, retry (429/500/529/504 + backoff), SSE streaming
- **PII guard:** `assertNoStudentPii` — student PII yuborilmaydi (redacted)
- API key server env'da (KMS), hech qachon browser/response'da emas
- Circuit breaker

**Xulosa:** Edikit AI backend'i — "DB service + adapter" arxitekturasi; **etishmayotgani: bepul provider implementatsiyasi**. `claude.client` pattern'iga o'xshash `qwen.client` / `groq.client` / `gemini.client` qo'shilsa — hammasi ishlaydi.

### AI kerak bo'lgan joylar (map):

| Funksiya | Modul (mavjud) | UI (rejalangan) | Nima kerak |
|---|---|---|---|
| **Katta matndan savol+variant+javob** | ai-question-gen | test-builder "AI yordamida yaratish" | RAG (source) + MCQ pipeline + structured JSON |
| **Slayd/presentatsiya** | presentation, deck-export, canva, google-slides | Content Studio (research.md 9) | LLM → canonical JSON → Marp/PptxGenJS |
| **AI grading (rubrik)** | ai-grading | teacher SpeedGrader | LLM ball taklifi + confidence |
| **AI checkpoint / plagiarism** | ai-checkpoint | — | LLM yoki lightweight model |
| **Tavsiyalar** | resource-reco | "mavzuni takrorlang" | lightweight / embedding |
| **AI chat/tutor** | claude | in-course assistant (P2) | LLM + RAG |

---

## 2. O'ZBEK TILI UCHUN REAL HOLAT (benchmark evidence)

### 2.1. O'zbek tili LLM'da — qiyin, lekin yechim bor

- **Zenodo 2025 benchmark** (Llama-3.2-1B, Qwen3-0.6B...): kichik modellar O'zbekchada "incoherent output, mixing languages"; **faqat Kimi-K2 Instruct practical usability** (BLEU 0.54 translation). Xulosa: **kichik (1-3B) modellar UZ uchun yetarli EMAS**.
- **TUMLU** (arxiv 2502.11020): **O'zbek uchun maxsus benchmark — 38139 savol, 8 til, 11 fan** (o'rta/maktab darajasida, Latin + Cyrillic). Modellar UZ'da ~35-52% (fan bo'yicha). **Bu Edikit MCQ sifatini o'lchash uchun AYNI manba** (golden set sifatida ishlatish mumkin).
- **behbudiy/UzLLM**: Mistral-7B-Instruct-Uz, Llama-3.1-8B-Instruct-Uz — O'zbekcha instruction-tuned (2024, eskiroq; sifat cheklangan).
- **Qwen3 oilasi**: BenchLM multilingual leaderboard'da **Qwen3.7 Max top-1** (2026-08); Qwen3 8B/14B — kuchli multilingual, **Apache 2.0** (to'liq bepul tijoriy).
- **Uzbek datasetlar (HuggingFace):**
  - `UAzimov/uzbek-instruct-llm` (14.2k instruct, Apache 2.0) — fine-tune uchun
  - `Gearnode/qwen3-asr-uzbek` (speech — hozir kerak emas)
  - TUMLU (UZ qismi) — benchmark/eval

### 2.2. Yechim (evidence asosida)

**Asosiy model: Qwen3 8B (yoki 14B) — self-host.** Nega:
- Apache 2.0 — to'liq bepul, tijoriy, cheklovsiz
- Multilingual kuchli (UZ da 8B "ishlaydigan" daraja — 1-3B lar ishlamaydi, zenodo)
- 8B Q4_K_M ≈ **5-6 GB VRAM** (RTX 3060/M1 16GB) yoki CPU-only 3-6 tok/s (async job uchun yetarli)
- Ollama: `ollama pull qwen3:8b` — 5 daqiqada; OpenAI-compatible API
- Data UZ'da qoladi (privacy qoidasi)

**Qo'llab-quvvatlash (failover):**
- **Groq bepul** (Llama 3.3 70B, 1000 req/kun, 30 RPM, ~500 tok/s, **no training on data** — privacy uchun eng xavfsiz tashqi variant)
- **Gemini Flash bepul** (1500 req/kun, 1M TPM — lekin **free-tier data Google'da train bo'ladi** → faqat anonim/umumiy kontent uchun, talaba PII EMAS)
- **NVIDIA NIM / Cerebras** — qo'shimcha failover

---

## 3. NOL XARAJAT STRATEGIYA (to'liq stack)

### 3.1. Self-host stack ($0 marginal xarajat)

```text
INFERENCE:  Ollama (yoki vLLM) + Qwen3 8B Q4_K_M  (~6GB VRAM / CPU-only)
            → OpenAI-compatible API: http://localhost:11434/v1
            → server UZ'da (data law), secret yo'q (localhost)
EMBEDDINGS: bge-m3 (1024 dims, multilingual, Ollama'da bor) yoki nomic-embed-text
            → bepul, self-host, UZ'da
VECTOR DB:  pgvector (PostgreSQL extension — ular allaqachon PG'da!)
            → $0, bitta DB, SQL+vector hybrid (tsvector + BM25 RRF)
EXPORT:     Marp (markdown→PPTX/PDF/HTML, LLM-friendly, headless CI)
            PptxGenJS (JS — repo stack bilan mos; editable PPTX)
            → hammasi bepul, ochiq manba
EVAL:       RAGAS (RAG quality: faithfulness>0.9, answer relevancy>0.85,
            context precision>0.8, context recall) — bepul, ochiq
            TUMLU (UZ MCQ eval), golden set (teacher accept logs)
FINE-TUNE:  Unsloth + Google Colab free T4 (16GB VRAM) — $0
            QLoRA 4-bit NF4, 8B ~6GB, 5K examples ~6 soat
```

**Hardware qarori (2 variant):**
| Variant | Xarajat | Tezlik | Mos |
|---|---|---|---|
| UZ VPS + CPU-only (Ollama Qwen3 8B Q4) | $20-40/oy VPS (mavjud infra) | 3-6 tok/s — **async job'lar uchun yetarli** (savol/slayd generatsiyasi — real-time emas) | ✅ Tavsiya (start) |
| UZ server + GPU (RTX 3060 12GB) | ~$300-500 bir martalik | 25-35 tok/s | Keyingi bosqich |
| Tashqi bepul (Groq/Gemini) | $0 | juda tez | Failover / non-PII |

**Muhim:** savol/slayd generatsiyasi **async job** (BullMQ queue — B-31 pattern) — 30-60s kutish normal. CPU-only Qwen3 8B 100-200 token savolni ~30-50s da yaratadi — UI'da "job status real-time" ko'rsatiladi (research.md 9.1 da shunday rejalangan).

### 3.2. Tashqi bepul API jadvali (failover uchun)

| Provider | Bepul limit | Data training | Privacy (UZ PII) | Izoh |
|---|---|---|---|---|
| **Groq** | 1000 req/kun, 30 RPM (Llama 3.3 70B) | **Yo'q** | ✅ Xavfsiz | Eng yaxshi tashqi failover (tez, no-train) |
| **Gemini Flash** | 1500 req/kun, 15 RPM, 1M TPM | **Ha** (free tier) | ⚠️ PII EMAS | Faqat anonim kontent; retry/backoff 429 |
| NVIDIA NIM | ~1000 req/kun (DeepSeek R1, Llama) | Yo'q | ✅ | Qo'shimcha |
| Cerebras | ~1M token/kun (Llama 3.3 70B) | Yo'q | ✅ | Qo'shimcha |
| OpenRouter | 50 req/kun, 20 RPM | O'zgaradi | ⚠️ | Ko'p model, past limit |
| Mistral | ~1B token/oy (Experiment) | Ha (opt-in) | ⚠️ | — |

**Failover zanjiri (kod pattern):** self-host (Qwen3) → Groq (no-train) → Gemini (anonim bo'lsa) → Claude (paid, oxirgi) — `claude.client`'dagi circuit breaker + retry pattern qayta ishlatiladi.

### 3.3. Xarajat taqqoslash (oylik, 10K req/kun)

| Stack | Xarajat | Izoh |
|---|---|---|
| **Edikit tavsiya (self-host + pgvector + Marp)** | **~$0 (VPS mavjud)** | GPU kerak emas (CPU async); embeddings bepul; vector bepul |
| OpenAI text-embedding + Claude API (to'liq) | $100-300/oy | Alternativ, lekin PII UZ'dan chiqadi + xarajat |
| Pinecone + OpenAI | $70 + $5 + $200 | Umuman kerak emas (pgvector bor) |

---

## 4. HAR FUNKSIYA UCHUN DIZAYN (evidence-based)

### 4.1. Katta matndan savol+variant+javob (MCQ generatsiya)

**Evidence (research round):**
- **Distractor sifati — asosiy muammo** (ACL 2025: DPO-trained distractor ranker; HEDGE: teacher 37% distractorni tuzatadi → human-in-loop shart)
- **Ikki bosqichli pipeline** (HEDGE/math): 1) stem + key + explanation, 2) misconceptions → distractors + feedback
- **Multi-agent** (AutoConverter/REQUESTA): proposer → reviewer → selector → evaluator; LLM-as-judge (5-point correctness)
- **Structured output:** JSON only, no markdown fences (StructEval); zod schema (repo'da bor)

**Edikit pipeline (design):**
```text
INPUT: katta matn (URL/PDF/DOCX/PPTX/key points — source pack)
  1. CHUNK: matnni bo'laklash (500-1000 token, overlap) — research.md 8.3
  2. RAG: pgvector'da tasdiqlangan source bo'yicha retrieval (faqat teacher ok'lagan manba)
  3. GENERATE (Qwen3 8B, structured JSON):
     step A: stem + correct answer + explanation (har chunk'dan N savol)
     step B: misconceptions → 3 distractor (plausible, no "too obvious")
     output: {question, options[], correctIndex, explanation, difficulty}
  4. VALIDATE: runAllValidators (mavjud!) + zod schema + JSON parse (no fence)
  5. 50/30/20: difficulty filter (easy/medium/hard) — mavjud
  6. OVERGENERATE 3-5 → tanlash (mavjud)
  7. HUMAN-IN-LOOP: teacher [Qabul]/[Tahrirlash] (mavjud lifecycle!) — APPROVED→item-bank
  8. LOG: teacher accept/edit → ai-mlops (kelajak fine-tune data)
EVAL (jarayonda): TUMLU UZ subset + golden set + LLM-as-judge + teacher acceptance rate
```

**Distractor sifatini oshirish (evidence):**
- Misconception-driven: LLM'dan "o'quvchilar qanday xato qiladi?" so'rash (HEDGE)
- NLI-filter: distractor = key ga implication/synonym bo'lsa o'chirish (UPB)
- Length/surface similarity: distractorlar key bilan o'xshash uzunlik (REQUESTA rubrik)

### 4.2. Slayd/presentatsiya generatsiya

**Evidence:** Marp = "most LLM-friendly" (near-CommonMark, headless CI, native PPTX); PptxGenJS (JS, editable PPTX); itarutomy97/marp-ai-slide-generator (JSON→MD→Marp→PPTX pattern); dashi-ppt-skill 4.5k⭐ (AI agent → HTML/PDF/PPTX).

**Edikit design (research.md 9.2 Canonical JSON — allaqachon rejalangan):**
```text
INPUT: matn/URL/PDF + audience + slide count + template
  1. LLM → canonical JSON (presentation.schema — repo'da bor):
     {title, audience, language, learningOutcomes, slides[], sources[], provider}
  2. JSON → Markdown (Marp format: --- separator, # title, bullets, notes)
  3. Marp → PPTX/PDF/HTML (headless, CI'da)
     yoki PptxGenJS (JS, editable PPTX — repo stack)
  4. Google Slides / Canva: mavjud adapter'lar (google-slides, canva modullari)
  5. "Create quiz from this deck": slides[].quizConcepts → 4.1 pipeline
  6. Teacher edit: native editor (canonical JSON qayta render)
EVAL: golden set (turli mavzu) + slide sifati LLM-judge + teacher acceptance
```

### 4.3. AI grading (rubrik)

**Evidence:** AI grading adoption 41% (ijtle); "teacher co-pilot" — AI taklif, teacher spot-check (research_ui_tech 4.2); confidence routing (research.md 7.5).
**Design:** Qwen3 8B + rubric (rubrik moduli bor) → ball taklifi + izoh + confidence; teacher [Qabul]/[Tahrirlash]; golden set eval (research.md 7.7: to'g'rilik, qabul darajasi).

### 4.4. Tavsiyalar (resource-reco)

**Design:** embedding-based (bge-m3) + pgvector similarity → "zaif mavzular → materiallar"; lightweight, server-side; PII yo'q.

### 4.5. AI chat/tutor (P2)

**Design:** RAG over approved sources + Qwen3 8B (self-host) — PII qo'riqlanadi, UZ'da; "teacher co-pilot" modeli (AI taklif, teacher nazorat).

---

## 5. DATA VA FINE-TUNE REJA (P2 — faqat kerak bo'lsa)

### 5.1. Data to'plash (hozirdanoq ishlaydi)
- **ai-mlops log:** har teacher [Qabul]/[Tahrirlash] — AI taklifi + yakuniy = training pair (anonim, UZ'da, DSAR)
- Open-source UZ datasetlar: `UAzimov/uzbek-instruct-llm` (14.2k), TUMLU (eval)
- Edikit o'z golden seti: 100-500 MCQ (fan bo'yicha, 4 til) + 50 slayd + 100 grading namuna

### 5.2. Qachon fine-tune kerak (P2/P3)
- Qwen3 8B structured JSON'da UZ sifati past bo'lsa (TUMLU'da o'lchanadi)
- Maxsus format (rubrik grading, canonical JSON) API'da barqaror chiqmasa

### 5.3. Fine-tune retsepti ($0, evidence)
```text
1. Model: Qwen3 8B (Apache 2.0, multilingual)
2. Usul: QLoRA 4-bit NF4 (Unsloth) — 8B ~6GB VRAM
3. Muhit: Google Colab free T4 (16GB VRAM) — $0
4. Data: 5K-10K examples (teacher accept/edit loglari + uzbek-instruct)
5. Vaqt: ~6 soat (Colab free)
6. Chiqish: LoRA adapter → Ollama'ga qo'yish (modelfile) yoki GGUF
7. Eval: TUMLU + golden set + regression (eski natijalar yomonlashmasin)
```
**Qoida:** RAG birinchi, fine-tune keyin (lushbinary: "most production systems use RAG first and add fine-tuning only if needed").

---

## 6. TEST / KAFOLAT (jarayonda — kim kafolatlaydi)

| Qatlam | Test | Kafolat |
|---|---|---|
| Structured output | zod schema + JSON parse (no fence) + retry | Har qanday model — barqaror JSON |
| Savol sifati | validators (mavjud) + LLM-as-judge + golden set | Quality gate |
| UZ tili | TUMLU UZ subset + native speaker review | O'zbekcha to'g'ri/chala aralashmaslik |
| RAG | RAGAS (faithfulness>0.9, relevancy>0.85, precision>0.8, recall) | Hallucination kamayadi |
| Distractor | teacher acceptance rate; NLI-filter | Plausible, not "too obvious" |
| Human-in-loop | APPROVED lifecycle (kodda) | Xato bo'lsa teacher tuzatadi — yakuniy qaror teacher'da |
| Model regression | golden set har versiyada | Fine-tune yomonlashtirmasligi |
| Privacy | assertNoStudentPii (mavjud) + self-host | Talaba PII UZ'da, tashqi API'ga emas |
| Perf | async job + queue (B-31) + timeout/retry/circuit-breaker | CPU-only'da ham ishlaydi |

**Kafolat beruvchi:** inson-in-the-loop (teacher [Qabul]/[Tahrirlash] kodda majburiy) + golden set + TUMLU/RAGAS — uch qatlam.

---

## 7. XULOSA — qaysi model, qayerda

| Qatlam | Yechim | Xarajat | Sifat | Privacy (UZ) |
|---|---|---|---|---|
| **Asosiy inference** | Qwen3 8B Q4 (Ollama/vLLM, UZ server, CPU yoki GPU) | $0 (mavjud VPS) | Yaxshi (8B — UZ da ishlaydigan daraja) | ✅ To'liq UZ'da |
| Failover 1 | Groq (Llama 3.3 70B, 1000 req/kun) | $0 | Yuqori | ✅ No-training |
| Failover 2 | Gemini Flash (1500 req/kun) | $0 | Yuqori | ⚠️ Faqat anonim |
| Oxirgi | Claude (mavjud adapter) | Paid | Eng yuqori | ⚠️ Faqat anonim/shartnoma |
| Embeddings | bge-m3 (Ollama) | $0 | Yaxshi | ✅ UZ'da |
| Vector DB | pgvector (mavjud PG) | $0 | — | ✅ UZ'da |
| Slides | Marp + PptxGenJS | $0 | Professional | ✅ |
| Eval | RAGAS + TUMLU + golden | $0 | — | — |
| Fine-tune (P2) | Unsloth + Colab T4, QLoRA 8B | $0 | Oshadi | Data UZ'da |

**Bosqichlar rejasi (kelajak prompt-guide AI_FEATURES):**
```text
AI-00..AI-05  — AI provider qatlami: qwen.client (Ollama), groq.client, gemini.client
                (claude.client pattern); failover + circuit breaker; config
AI-06..AI-11  — RAG: pgvector migration, chunking, embeddings (bge-m3), retrieval,
                RAGAS eval; source approval (teacher ok)
AI-12..AI-18  — MCQ generatsiya: chunk→RAG→2-step generate→validate→50/30/20→
                overgenerate→human review (mavjud ai-question-gen'ga ulash); TUMLU eval
AI-19..AI-24  — Presentation studio: canonical JSON→Marp/PptxGenJS→PPTX/PDF/HTML;
                deck→quiz; teacher edit (mavjud presentation/deck-export modullariga)
AI-25..AI-28  — AI grading + tavsiyalar (mavjud ai-grading/resource-reco'ga bepul model)
AI-29..AI-33  — Data yig'ish (ai-mlops), golden set, eval dashboards, fine-tune reja
                (Unsloth+Colab — P2), final AI release + sign-off
```
Har biri 30-40 qator, Global Master Prompt (AI) bilan — AUTH/UIUX tizimi kabi.

---

## 8. MANBALAR (real, tekshirilgan)

### O'zbek tili / modellar
huggingface.co/Gearnode/qwen3-asr-uzbek-v2 · huggingface.co/UAzimov/uzbek-instruct-llm (14.2k) · huggingface.co/behbudiy/Mistral-7B-Instruct-Uz · huggingface.co/behbudiy/Llama-3.1-8B-Instruct-Uz · zenodo.org/records/17223973 (UZ LLM benchmark — Kimi-K2 yagona usable) · arxiv.org/abs/2502.11020 (TUMLU — Turkic/UZ benchmark, 38139 savol) · benchlm.ai/multilingual (Qwen3.7 Max top-1) · benchlm.ai/best/translation · arxiv 2302.14494 (UZ text classification dataset)

### Self-host / VRAM
promptquorum.com (Qwen3 local 2026 — 27B 16GB, 7B 5GB) · techjacksolutions.com (Qwen3 8B 5-6GB, 32B 20GB, MoE 25 tok/s) · localaimaster.com (best OSS LLMs 2026 — Apache 2.0: Qwen3/DeepSeek/Gemma) · kunalganglani.com (VRAM tiers) · computingforgeeks.com (Ollama cheat sheet) · huggingface.co/blog (best local models) · codersera.com (Qwen3-8B Windows)

### MCQ generatsiya
aclanthology.org/2025.acl-long.1154 (DPO distractor ranker) · arxiv 2405.00864 (HEDGE — human-AI distractor) · github.com/csv610/mcq_generator (LiteLLM multi-provider) · upb.ro (NLI distractor filtering) · arxiv 2501.03225 (AutoConverter multi-agent) · arxiv 2602.03704 (REQUESTA multi-agent rubric) · openreview StructEval (structured output JSON) · arxiv 2405.11966 (MCQ as evaluators)

### RAG / vector DB / eval
danubedata.ro (pgvector RAG 2026 — price table) · dev.to soumia (RAG stacks) · firecrawl.dev (vector DB comparison) · awesomeagents.ai (best RAG tools) · zenml.io (vector DBs) · dev.to thegdsks (pgvector TypeScript pipeline) · lushbinary.com (RAG patterns + RAGAS metrics: faithfulness>0.9 etc) · aimultiple.com (vector DB benchmark)

### Slides
notes.nicolasdeville.com (Marp/reveal.js/PptxGenJS comparison — Marp most LLM-friendly) · github.com/itarutomy97/marp-ai-slide-generator (JSON→MD→Marp→PPTX) · github.com/topics/slide-generator (dashi-ppt-skill 4.5k⭐) · edtr.md (markdown presentations) · deckary.com (markdown slides tools)

### Fine-tuning
unsloth.ai/docs (Qwen3.5 fine-tune free Colab) · letsdatascience.com (LoRA/QLoRA — 8B QLoRA ~6GB, $0 Colab) · kdnuggets.com (QLoRA free Colab) · buildmvpfast.com (QLoRA laptop 2026) · mlops.community (Unsloth Llama 3 8B budget fine-tune — 5.67GB VRAM) · codersera.com (fine-tuning cost table 2026: 7B QLoRA 5K ex ~6h $0 Colab)

### Bepul API
dev.to lemondata (free AI APIs 2026 — Gemini 500-1500 req/day, Groq, Mistral) · awesomeagents.ai (free inference providers — full table) · aimadetools.com (best free AI APIs — Google AI Studio #1) · openrouter.ai (free LLM APIs compared — privacy table) · tokenmix.ai (Gemini free 1500 RPD / 1M TPM / data training trade-off) · apiscout.dev (Gemini limits)

### Edikit repo (o'qildi)
src/modules/ai-question-gen/ (blueprint, 50/30/20, overgenerate, validators, lifecycle) · src/modules/claude/claude.client.js (fetch, retry, SSE, PII guard, circuit breaker) · src/modules/ai-mlops/ · src/modules/presentation/ · src/modules/deck-export/ · research.md 7-10 (grading pipeline, AI generator, Content Studio, unified flow)
