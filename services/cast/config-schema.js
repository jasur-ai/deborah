/**
 * Edikit — Canonical Cast Config Schema
 * --------------------------------------
 * Barcha Cast setup qiymatlari bitta versioned Zod schema orqali
 * parse va validate qilinadi. Teacher yuborishi mumkin bo'lmagan
 * system fieldlar input schema'da yo'q.
 *
 * - CastConfigInputSchema  → POST body (preset + overrides) uchun
 * - CastConfigSnapshotSchema → session snapshot'ga yoziladigan resolved config
 */

import { z } from 'zod';
import crypto from 'crypto';
import {
  CAST_SCHEMA_VERSION,
  CAST_PACE,
  CAST_ADVANCE_MODE,
  CAST_CLOSE_TRIGGER,
  CAST_TIMER_MODE,
  CAST_SCORING_MODE,
  CAST_SCORING_VERSION,
  CAST_SCORE_POLICY,
  CAST_LB_VISIBILITY,
  CAST_LB_FREQUENCY,
  CAST_JOIN_IDENTITY,
  CAST_LATE_JOIN_POLICY,
  CAST_FEEDBACK_POLICY,
  CAST_CONFIDENCE_POLICY,
  CAST_BOUNDS,
  CAST_QUESTION_TYPES,
  POWERUP_TYPE_LIST,
} from '../../utils/cast-constants.js';

const zEnum = (obj) => z.enum(Object.values(obj));

// ── Source reference (G0-03 ownership) ──
export const SourceSchema = z
  .object({
    type: z.enum(['user', 'mock', 'pre']),
    key: z.string().min(1).max(120),
    chunk: z.string().nullable().optional(),
  })
  .strict();

// ── Playback ──
const PlaybackSchema = z
  .object({
    advanceMode: zEnum(CAST_ADVANCE_MODE),
    closeTrigger: z.array(zEnum(CAST_CLOSE_TRIGGER)).min(1),
    thinkSeconds: z.number().int().min(CAST_BOUNDS.THINK_MIN_SECONDS).max(CAST_BOUNDS.THINK_MAX_SECONDS),
    minimumOpenSeconds: z.number().int().min(0).max(30).default(3),
  })
  .strict();

// ── Timer ──
const TimerSchema = z
  .object({
    mode: zEnum(CAST_TIMER_MODE),
    defaultSeconds: z
      .number()
      .int()
      .min(CAST_BOUNDS.TIMER_MIN_SECONDS)
      .max(CAST_BOUNDS.TIMER_MAX_SECONDS)
      .default(30),
    allowHostExtend: z.boolean().default(true),
    maxExtensionsPerQuestion: z
      .number()
      .int()
      .min(0)
      .max(CAST_BOUNDS.MAX_EXTENSIONS_PER_QUESTION)
      .default(CAST_BOUNDS.MAX_EXTENSIONS_PER_QUESTION),
  })
  .strict();

// ── Scoring ──
const ScoringSchema = z
  .object({
    mode: zEnum(CAST_SCORING_MODE),
    version: z.string().default(CAST_SCORING_VERSION),
    correctBase: z.number().int().min(0).max(100000).default(1000),
    speedBonusMax: z.number().int().min(0).max(100000).default(0),
    wrongPoints: z.number().int().default(0),
    tieBreak: z.enum(['same_rank_then_stable_display']).default('same_rank_then_stable_display'),
    partialCredit: z.boolean().default(false),
    multiplier: z.number().min(0).max(10).default(1),
    // C3-03 Vote→Discuss→Revote: revote bo'lsa qaysi ball olinadi
    scorePolicy: zEnum(CAST_SCORE_POLICY).default(CAST_SCORE_POLICY.FIRST_ONLY),
    // C4-08: institution governance limit — max speed weight (0..1 → speedBonusMax ball)
    maxSpeedWeight: z.number().min(0).max(1).default(0.2),
  })
  .strict();

// ── Leaderboard ──
const LeaderboardSchema = z
  .object({
    visibility: zEnum(CAST_LB_VISIBILITY).default('off_during_learning'),
    finalVisibility: zEnum(CAST_LB_VISIBILITY).default('top_n'),
    topN: z.number().int().min(1).max(100).default(5),
    frequency: zEnum(CAST_LB_FREQUENCY).default('end_only'),
    anonymizeLowRanks: z.boolean().default(true),
    showExactScore: z.boolean().default(false),
  })
  .strict();

// ── Feedback ──
const FeedbackSchema = z
  .object({
    correctness: zEnum(CAST_FEEDBACK_POLICY).default('teacher_controlled'),
    correctAnswer: zEnum(CAST_FEEDBACK_POLICY).default('teacher_controlled'),
    explanation: zEnum(CAST_FEEDBACK_POLICY).default('teacher_controlled'),
    responseDistribution: zEnum(CAST_FEEDBACK_POLICY).default('teacher_controlled'),
  })
  .strict();

// ── Join ──
const JoinSchema = z
  .object({
    identity: zEnum(CAST_JOIN_IDENTITY).default('safe_alias'),
    allowLateJoin: z.boolean().default(true),
    lateJoinPolicy: zEnum(CAST_LATE_JOIN_POLICY).default('next_question'),
    lateJoinUntilQuestion: z.number().int().min(1).max(500).default(3),
    lockLobbyOnStart: z.boolean().default(true),
    maxPlayers: z
      .number()
      .int()
      .min(CAST_BOUNDS.MAX_PLAYERS_MIN)
      .max(CAST_BOUNDS.MAX_PLAYERS_MAX)
      .default(100),
  })
  .strict();

// ── Presentation (theme/audio/motion) ──
const PresentationSchema = z
  .object({
    themeId: z.string().min(1).default('focus_dark'),
    motion: z.enum(['full', 'reduced', 'none']).default('reduced'),
    lobbyMusic: z.enum(['off', 'low', 'on']).default('off'),
    questionMusic: z.enum(['off', 'low', 'on']).default('off'),
    soundEffects: z.enum(['off', 'low', 'on']).default('low'),
  })
  .strict();

// ── Recording (C4-08 governance: recording.alwaysAsk false, modality default) ──
const RecordingSchema = z
  .object({
    enabled: z.boolean().default(false),
    modality: z.enum(['none', 'audio', 'video']).default('none'),
    retentionClass: z.enum(['camera_mic', 'ephemeral']).default('camera_mic'),
  })
  .strict();

// ── Media (C4-08 governance: external media policy) ──
const MediaSchema = z
  .object({
    lazyLoadThemes: z.boolean().default(true),
    externalImages: z.enum(['block', 'allow_https']).default('block'),
    maxDimensionPx: z.number().int().min(0).max(8192).default(1920),
  })
  .strict();

// ── Teams ──
const TeamsSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(['individual_then_aggregate', 'single_team_device']).default('individual_then_aggregate'),
    assignment: z.enum(['manual', 'random', 'balanced', 'roster']).default('random'),
    count: z.number().int().min(CAST_BOUNDS.TEAM_COUNT_MIN).max(CAST_BOUNDS.TEAM_COUNT_MAX).default(4),
    scoreAggregation: z.enum(['normalized_average', 'sum_equal_size', 'individual']).default('normalized_average'),
    // C4-01: team talk phase + reporter rotation
    talkEnabled: z.boolean().default(true),
    talkSeconds: z.number().int().min(10).max(600).default(60),
    reporterRotation: z.boolean().default(true),
    // Tie policy — equal score'dagi jamoa tartibi (leaderboard service'ga beriladi)
    tiePolicy: z.enum(['first_answered', 'alphabetical', 'same_rank']).default('first_answered'),
  })
  .strict();

// ── Responsive teaching ──
const ResponsiveTeachingSchema = z
  .object({
    hingeRecommendations: z.boolean().default(true),
    confidencePolicy: zEnum(CAST_CONFIDENCE_POLICY).default('strategic_items'),
    confidencePrompt: z.enum(['inline', 'after_answer']).default('inline'),
    peerInstructionAvailable: z.boolean().default(true),
    firstVoteDistribution: z.enum(['teacher_private', 'public']).default('teacher_private'),
    misconceptionMap: z.boolean().default(true),
    reasoningCapture: z.enum(['off', 'selected_items', 'all_items']).default('selected_items'),
    confusionSignal: z.boolean().default(true),
    quickPrompt: z.boolean().default(true),
    // C3-13 Student Question Forge (student savol draftlarini yuborishi)
    questionForge: z.boolean().default(true),
    // Institution policy: draft muallifi director queue'da qanday ko'rinadi
    forgeAttribution: z.enum(['private', 'public_alias']).default('private'),
    // C3-03 Vote→Discuss→Revote
    discussionEnabled: z.boolean().default(true),
    discussionDefaultSeconds: z.number().int().min(0).max(600).default(60),
    showPreviousOnRevote: z.boolean().default(true),
  })
  .strict();

// ── Personal progress (C3-09) ──
const PersonalProgressSchema = z
  .object({
    visibility: z.enum(['private', 'opt_in_public']).default('private'),
    // opt_in_public = participant opt-in bo'lsa projector'ga chiqadi
  })
  .strict();

// ── Power-ups (C3-17) — pedagogically safe, default OFF ──
const PowerUpsSchema = z
  .object({
    enabled: z.boolean().default(false),
    // Allowed types — teacher/preset tomonidan belgilanadi (item 4).
    // Faqat POWERUP_TYPES registry'dan; random elimination/sabotage mumkin emas.
    allowedTypes: z.array(z.enum(POWERUP_TYPE_LIST)).default([]),
    // Per-participant starting inventory (server authoritative; item 5)
    // z.record(z.enum(...)) zod'da barcha enum key'larni majburiy qiladi —
    // optional object ishlatamiz (bo'sh inventory ham valid).
    startingInventory: z
      .object({
        hint: z.number().int().min(0).max(9).optional(),
        extra_time: z.number().int().min(0).max(9).optional(),
        team_consult: z.number().int().min(0).max(9).optional(),
        private_redemption: z.number().int().min(0).max(9).optional(),
      })
      .default({}),
    // extra_time uzaytirish soniyalari (item 7 — faqat personal timer uchun)
    extraTimeSeconds: z.number().int().min(5).max(120).default(15),
    // Team power-up barcha memberga apply bo'lishi (item 11)
    teamConsistent: z.boolean().default(true),
  })
  .strict();

// ── Self-paced race (C3-16) ──
const SelfPacedSchema = z
  .object({
    enabled: z.boolean().default(false),
    // per-participant question timer (soniyalarda). off = limit yo'q.
    perQuestionSeconds: z.number().int().min(10).max(600).default(60),
    // question order: session-seeded, har participant uchun randomize
    randomizeOrder: z.boolean().default(true),
    // late join start: 'first' = birinchi savoldan, 'position' = konfiguratsiyadan
    lateJoinStart: z.enum(['first', 'position']).default('first'),
    lateJoinPosition: z.number().int().min(0).max(200).default(0),
    // rank: private = faqat o'z rankini ko'radi; opt_in_public = ruxsat bersa
    rankVisibility: z.enum(['private', 'opt_in_public']).default('private'),
    // public live full rank — default OFF (C3-16 item 11)
    publicLiveRank: z.boolean().default(false),
    // network fairness health (C3-16 item 10)
    fairnessWindowSeconds: z.number().int().min(5).max(300).default(30),
  })
  .strict();

// ── Class goal (C3-09) ──
const ClassGoalSchema = z
  .object({
    enabled: z.boolean().default(false),
    type: z.enum(['accuracy_threshold', 'misconceptions_resolved', 'knowledge_points', 'mastery_rounds']).default('accuracy_threshold'),
    target: z.number().int().min(1).max(10000).default(80),
  })
  .strict();

// ── Moderation ──
const ModerationSchema = z
  .object({
    publicChat: z.boolean().default(false),
    directMessages: z.boolean().default(false),
    openTextVisibility: z.enum(['host_review_first', 'public_after_approval']).default('host_review_first'),
    questionWall: z.enum(['off', 'moderated']).default('moderated'),
    publicIdentity: z.enum(['safe_alias', 'anonymous']).default('safe_alias'),
  })
  .strict();

// ── Accessibility ──
const AccessibilitySchema = z
  .object({
    showQuestionOnDevice: z.boolean().default(true),
    highContrastAvailable: z.boolean().default(true),
    reducedMotionDefault: z.boolean().default(true),
    audioHasVisualEquivalent: z.boolean().default(true),
    keyboardDirector: z.boolean().default(true),
    screenReaderStatus: z.boolean().default(true),
    // C4-04 (item 18): default theme (focus_dark | focus_light | hc_dark | hc_light)
    defaultTheme: z
      .enum(['focus_dark', 'focus_light', 'hc_dark', 'hc_light'])
      .default('focus_dark'),
    // C4-04 (item 20): personal long-time / no-timer accommodation hook
    accommodation: z
      .object({
        longTimeMs: z.number().int().min(0).max(3600000).default(0),
        noTimer: z.boolean().default(false),
      })
      .default({ longTimeMs: 0, noTimer: false }),
  })
  .strict();

// ── Participation (delivery) ──
const ParticipationSchema = z
  .object({
    delivery: z.enum(['in_room', 'remote', 'hybrid']).default('in_room'),
    paperCardMode: z.boolean().default(false),
    // C4-03 (item 1): P3 feature flag — paper-card scanner oldin opt-in
    cardScanP3: z.boolean().default(true),
  })
  .strict();

// ── Localization ──
const LocalizationSchema = z
  .object({
    locale: z.string().min(2).max(10).default('uz-Latn'),
    rtl: z.boolean().default(false),
  })
  .strict();

// ── Data lifecycle (C4-07) ──
const DataLifecycleSchema = z
  .object({
    policyId: z.string().min(1).default('institution_default_v1'),
    policyVersion: z.number().int().min(1).default(1),
    retentionClass: z.enum(['standard', 'extended', 'minimal']).default('standard'),
    // C4-07 (item 4): session create'da policy snapshotga pin qilinadi
    pinnedPolicyHash: z.string().max(80).optional(),
    // C4-07 (item 17): camera/microphone data class — Cast Core'da DISABLED
    cameraMicrophone: z
      .object({
        enabled: z.boolean().default(false),
        dataClass: z.literal('camera_mic').default('camera_mic'),
      })
      .default({ enabled: false, dataClass: 'camera_mic' }),
    // C4-07 (item 18): O'zbekiston legal approval checklist
    uzLegalApprovals: z
      .object({
        uz_law_pdpl: z.boolean().default(false),
        uz_camera_consent: z.boolean().default(false),
        uz_minor_consent: z.boolean().default(false),
        uz_retention_disclosure: z.boolean().default(false),
        uz_cross_border: z.boolean().default(false),
      })
      .default({}),
    // C4-07 (item 3): institution custom class override (per-class retention)
    classOverrides: z
      .object({
        join_token: z.object({ days: z.number().min(0).optional(), expiryAction: z.enum(['DELETE', 'ANONYMIZE', 'REVIEW_OR_DELETE', 'ROLLING']).optional() }).optional(),
        recovery_state: z.object({ days: z.number().min(0).optional(), expiryAction: z.enum(['DELETE', 'ANONYMIZE', 'REVIEW_OR_DELETE', 'ROLLING']).optional() }).optional(),
        named_answer: z.object({ days: z.number().min(0).optional(), expiryAction: z.enum(['DELETE', 'ANONYMIZE', 'REVIEW_OR_DELETE', 'ROLLING']).optional() }).optional(),
        open_text: z.object({ days: z.number().min(0).optional(), expiryAction: z.enum(['DELETE', 'ANONYMIZE', 'REVIEW_OR_DELETE', 'ROLLING']).optional() }).optional(),
        action_pack: z.object({ days: z.number().min(0).optional(), expiryAction: z.enum(['DELETE', 'ANONYMIZE', 'REVIEW_OR_DELETE', 'ROLLING']).optional() }).optional(),
        aggregate: z.object({ days: z.number().min(0).optional(), expiryAction: z.enum(['DELETE', 'ANONYMIZE', 'REVIEW_OR_DELETE', 'ROLLING']).optional() }).optional(),
        audit_log: z.object({ days: z.number().min(0).optional(), expiryAction: z.enum(['DELETE', 'ANONYMIZE', 'REVIEW_OR_DELETE', 'ROLLING']).optional() }).optional(),
        support_bundle: z.object({ days: z.number().min(0).optional(), expiryAction: z.enum(['DELETE', 'ANONYMIZE', 'REVIEW_OR_DELETE', 'ROLLING']).optional() }).optional(),
      })
      .default({}),
  })
  .strict();

// ── Resilience ──
const ResilienceSchema = z
  .object({
    reconnectGraceMs: z.number().int().min(1000).max(600000).default(120000),
    hostDisconnectGraceMs: z.number().int().min(1000).max(600000).default(60000),
    // C4-02 Hybrid / low-bandwidth
    networkTelemetry: z.boolean().default(true),
    lowBandwidth: z
      .object({
        enabled: z.boolean().default(false),
        // Decorative event/animatsiya disable (item 11)
        decorativeEventsOff: z.boolean().default(true),
        // Media derivative / payload chegarasi (item 10)
        maxMediaKb: z.number().int().min(0).max(2048).default(120),
      })
      .default({}),
  })
  .strict();

// ── Post-cast ──
const PostCastSchema = z
  .object({
    actionPack: z.boolean().default(true),
    eventReplay: z.boolean().default(true),
    studentPrivateRecap: z.boolean().default(true),
    teacherReflection: z.boolean().default(true),
  })
  .strict();

// ── AI (shadow only, no live actions) ──
const AiSchema = z
  .object({
    cohostMode: z.enum(['off', 'shadow']).default('off'),
    mayExecuteLiveActions: z.boolean().default(false),
    teacherApprovalRequired: z.boolean().default(true),
  })
  .strict();

// ── INPUT schema: teacher sends presetId + partial overrides ──
// C5-05 (item 7): performance / payload feature flags.
// safeNextPrefetch — keyingi savolni faqat public-safe shaklda prefetch qilish
// (answer key / explanation hech qachon kirmaydi). Default OFF (opt-in).
export const PerfSchema = z
  .object({
    safeNextPrefetch: z.boolean().default(false),
    timerUpdateMs: z.number().int().min(250).max(2000).default(1000),
    answerCountCoalesceMs: z.number().int().min(40).max(1000).default(120),
  })
  .strict();

export const CastConfigInputSchema = z
  .object({
    presetId: z.string().min(1),
    overrides: z
      .object({
        pace: zEnum(CAST_PACE).optional(),
        playback: PlaybackSchema.partial().optional(),
        timer: TimerSchema.partial().optional(),
        scoring: ScoringSchema.partial().optional(),
        leaderboard: LeaderboardSchema.partial().optional(),
        feedback: FeedbackSchema.partial().optional(),
        join: JoinSchema.partial().optional(),
        presentation: PresentationSchema.partial().optional(),
        recording: RecordingSchema.partial().optional(),
        media: MediaSchema.partial().optional(),
        teams: TeamsSchema.partial().optional(),
        responsiveTeaching: ResponsiveTeachingSchema.partial().optional(),
        moderation: ModerationSchema.partial().optional(),
        accessibility: AccessibilitySchema.partial().optional(),
        participation: ParticipationSchema.partial().optional(),
        localization: LocalizationSchema.partial().optional(),
        dataLifecycle: DataLifecycleSchema.partial().optional(),
        resilience: ResilienceSchema.partial().optional(),
        postCast: PostCastSchema.partial().optional(),
        ai: AiSchema.partial().optional(),
        personalProgress: PersonalProgressSchema.partial().optional(),
        classGoal: ClassGoalSchema.partial().optional(),
        selfPaced: SelfPacedSchema.partial().optional(),
        powerUps: PowerUpsSchema.partial().optional(),
        perf: PerfSchema.partial().optional(),
      })
      .default({}),
  })
  .strict();

// ── SNAPSHOT schema: resolved full config, written to session ──
export const CastConfigSnapshotSchema = z
  .object({
    schemaVersion: z.number().int().default(CAST_SCHEMA_VERSION),
    preset: z
      .object({
        id: z.string(),
        version: z.number().int(),
        customized: z.boolean(),
      })
      .strict(),
    source: SourceSchema,
    pace: zEnum(CAST_PACE),
    playback: PlaybackSchema,
    timer: TimerSchema,
    scoring: ScoringSchema,
    leaderboard: LeaderboardSchema,
    feedback: FeedbackSchema,
    join: JoinSchema,
    presentation: PresentationSchema,
    recording: RecordingSchema,
    media: MediaSchema,
    teams: TeamsSchema,
    responsiveTeaching: ResponsiveTeachingSchema,
    moderation: ModerationSchema,
    accessibility: AccessibilitySchema,
    participation: ParticipationSchema,
    localization: LocalizationSchema,
    dataLifecycle: DataLifecycleSchema,
    resilience: ResilienceSchema,
    postCast: PostCastSchema,
    ai: AiSchema,
    personalProgress: PersonalProgressSchema,
    classGoal: ClassGoalSchema,
    selfPaced: SelfPacedSchema,
    powerUps: PowerUpsSchema,
    perf: PerfSchema,
  })
  .strict();

// ── Cross-field validation (superRefine) ──
export function validateCrossField(config) {
  const errors = [];
  const add = (path, code, message) => errors.push({ path, code, message });

  // Timer off + fully_auto → blocker
  if (config.timer.mode === 'off' && config.playback.advanceMode === 'fully_auto') {
    add('timer.mode', 'CROSS_FIELD_BLOCKER', 'Taymer o‘chiq holda avto rejim ishlamaydi');
  }
  // Timer off + strict-only close trigger → blocker
  if (
    config.timer.mode === 'off' &&
    config.playback.closeTrigger.length === 1 &&
    config.playback.closeTrigger[0] === 'host_or_soft_timeout'
  ) {
    // soft timeout only makes sense with a timer; with off timer only host/auto triggers allowed
    add('playback.closeTrigger', 'CROSS_FIELD_BLOCKER', 'Taymer o‘chiq bo‘lsa soft-timeout trigger ishlamaydi');
  }
  // Anonymous identity + personal public leaderboard → blocker
  if (
    config.join.identity === 'anonymous' &&
    ['personal_only', 'relative_neighbors'].includes(config.leaderboard.visibility)
  ) {
    add('join.identity', 'CROSS_FIELD_BLOCKER', 'Anonim ishtirokchida shaxsiy reyting ko‘rsatib bo‘lmaydi');
  }
  // Team enabled + count < 2 → blocker (schema already bounds 2..8, but keep explicit)
  if (config.teams?.enabled && config.teams.count < CAST_BOUNDS.TEAM_COUNT_MIN) {
    add('teams.count', 'CROSS_FIELD_BLOCKER', 'Jamoa soni kamida 2 bo‘lishi kerak');
  }
  // No points + speed bonus > 0 → error
  if (config.scoring.mode === 'no_points' && config.scoring.speedBonusMax > 0) {
    add('scoring.speedBonusMax', 'CROSS_FIELD_BLOCKER', 'Ball yo‘q rejimda tezlik bonusi ishlamaydi');
  }
  // Fully auto without a valid close trigger → blocker
  if (
    config.playback.advanceMode === 'fully_auto' &&
    !config.playback.closeTrigger.some((t) => ['all_answered', 'auto_after_max', 'host_or_soft_timeout'].includes(t))
  ) {
    add('playback.closeTrigger', 'CROSS_FIELD_BLOCKER', 'Avto rejim uchun valid yopilish trigeri kerak');
  }
  // C4-08 (item 6): recording enabled — camera_mic class C4-07'da 0d DISABLED,
  // retention darhol o'chirib yuboradi → ephemeral talab qilinadi
  if (config.recording?.enabled === true && config.recording?.retentionClass === 'camera_mic') {
    add('recording.retentionClass', 'CROSS_FIELD_BLOCKER', 'Recording yozuvi camera_mic (0 kun) saqlanmaydi — retentionClass ephemeral bo‘lishi kerak');
  }
  // C4-03 (item 14): paper-card mode faqat MCQ va True/False bilan ishlaydi
  if (config.participation.paperCardMode === true) {
    // Question type'lar session creation'da tekshiriladi (test-loader'dan);
    // bu yerda config-level guard: scoring no_points paper bilan mos emas
    if (config.scoring.mode === 'no_points') {
      add('participation.paperCardMode', 'CROSS_FIELD_BLOCKER', 'Qog‘oz kartochka rejimida ball yo‘q rejim ishlamaydi');
    }
  }
  // C4-02 (item 3/4/5): Hybrid — question-on-device majburiy + speed bonus default 0
  if (config.participation.delivery === 'hybrid') {
    // Remote participantlar savolni o'z qurilmasida ko'rishi shart (item 3)
    if (config.accessibility.showQuestionOnDevice === false) {
      add('participation.delivery', 'CROSS_FIELD_BLOCKER', 'Hybrid rejimda savol qurilmada ko‘rinishi shart (accessibility.showQuestionOnDevice)');
    }
    // Hybrid'da speed bonus adolatsiz — default 0 (item 4); blocking emas,
    // chunki speed mode tanlansa qo'shimcha warning'ga olib boradi (item 5).
  }
  // Hybrid + speed mode → warning (not blocker by default)
  const warnings = [];
  if (config.participation.delivery === 'hybrid' && config.scoring.mode === 'speed') {
    warnings.push({
      path: 'scoring.mode',
      code: 'HYBRID_SPEED_WARNING',
      message: 'Gibrid rejimda tezlik balli adolatga ta’sir qilishi mumkin',
    });
  }
  return { errors, warnings };
}

/**
 * Canonical serialization: deterministic key-sorted JSON (hash stability).
 */
export function canonicalSerialize(config) {
  return JSON.stringify(sortKeysDeep(config));
}

/** Recursively sort object keys for canonical serialization */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Canonical config hash (sha256) — session fingerprint / idempotency.
 */
export function hashConfig(config) {
  return 'sha256:' + crypto.createHash('sha256').update(canonicalSerialize(config)).digest('hex');
}

export { CAST_SCHEMA_VERSION };
