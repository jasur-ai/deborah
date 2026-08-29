import { describe, it, expect } from 'vitest';
import {
  CastConfigInputSchema,
  CastConfigSnapshotSchema,
  validateCrossField,
  hashConfig,
  canonicalSerialize,
} from '../../services/cast/config-schema.js';
import { resolvePreset } from '../../services/cast/presets.js';

const validInput = {
  presetId: 'responsive_accuracy',
  overrides: { timer: { defaultSeconds: 45 } },
};

describe('CastConfigInputSchema', () => {
  it('accepts valid preset + overrides', () => {
    const r = CastConfigInputSchema.safeParse(validInput);
    expect(r.success).toBe(true);
  });

  it('accepts empty overrides', () => {
    const r = CastConfigInputSchema.safeParse({ presetId: 'classic_live' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown top-level field (strict)', () => {
    const r = CastConfigInputSchema.safeParse({ presetId: 'x', mystery: 1 });
    expect(r.success).toBe(false);
  });

  it('rejects missing presetId', () => {
    const r = CastConfigInputSchema.safeParse({ overrides: {} });
    expect(r.success).toBe(false);
  });

  it('rejects out-of-range timer seconds', () => {
    const r = CastConfigInputSchema.safeParse({ presetId: 'x', overrides: { timer: { defaultSeconds: 9999 } } });
    expect(r.success).toBe(false);
  });

  it('rejects invalid enum value', () => {
    const r = CastConfigInputSchema.safeParse({ presetId: 'x', overrides: { timer: { mode: 'nope' } } });
    expect(r.success).toBe(false);
  });

  it('rejects invalid timer below min', () => {
    const r = CastConfigInputSchema.safeParse({ presetId: 'x', overrides: { timer: { defaultSeconds: 1 } } });
    expect(r.success).toBe(false);
  });
});

describe('Cross-field validation', () => {
  function makeConfig(overrides = {}) {
    const { config } = resolvePreset('responsive_accuracy', {});
    return { ...config, timer: { ...config.timer, ...(overrides.timer || {}) }, playback: { ...config.playback, ...(overrides.playback || {}) }, scoring: { ...config.scoring, ...(overrides.scoring || {}) }, join: { ...config.join, ...(overrides.join || {}) }, teams: { ...config.teams, ...(overrides.teams || {}) }, leaderboard: { ...config.leaderboard, ...(overrides.leaderboard || {}) }, participation: { ...config.participation, ...(overrides.participation || {}) }, recording: { ...config.recording, ...(overrides.recording || {}) } };
  }

  it('blocks timer off + fully auto', () => {
    const c = makeConfig({ timer: { mode: 'off' }, playback: { advanceMode: 'fully_auto' } });
    const { errors } = validateCrossField(c);
    expect(errors.some((e) => e.path === 'timer.mode')).toBe(true);
  });

  it('blocks anonymous + personal public leaderboard', () => {
    const c = makeConfig({ join: { identity: 'anonymous' }, leaderboard: { visibility: 'personal_only' } });
    const { errors } = validateCrossField(c);
    expect(errors.some((e) => e.path === 'join.identity')).toBe(true);
  });

  it('blocks no_points + speed bonus', () => {
    const c = makeConfig({ scoring: { mode: 'no_points', speedBonusMax: 100 } });
    const { errors } = validateCrossField(c);
    expect(errors.some((e) => e.path === 'scoring.speedBonusMax')).toBe(true);
  });

  it('passes responsive accuracy default', () => {
    const c = makeConfig();
    const { errors } = validateCrossField(c);
    expect(errors.length).toBe(0);
  });

  it('warns on hybrid + speed', () => {
    const c = makeConfig({ participation: { delivery: 'hybrid' }, scoring: { mode: 'speed' } });
    const { errors, warnings } = validateCrossField(c);
    expect(errors.length).toBe(0);
    expect(warnings.some((w) => w.code === 'HYBRID_SPEED_WARNING')).toBe(true);
  });

  it('blocks recording enabled + camera_mic retention (0d DISABLED)', () => {
    const c = makeConfig({ recording: { enabled: true, modality: 'audio', retentionClass: 'camera_mic' } });
    const { errors } = validateCrossField(c);
    expect(errors.some((e) => e.path === 'recording.retentionClass')).toBe(true);
  });

  it('allows recording enabled + ephemeral retention', () => {
    const c = makeConfig({ recording: { enabled: true, modality: 'audio', retentionClass: 'ephemeral' } });
    const { errors } = validateCrossField(c);
    expect(errors.some((e) => e.path === 'recording.retentionClass')).toBe(false);
  });
});

describe('C4-08 governance config fields', () => {
  it('input overrides accept scoring.maxSpeedWeight in range', () => {
    const r = CastConfigInputSchema.safeParse({ presetId: 'responsive_accuracy', overrides: { scoring: { maxSpeedWeight: 0.4 } } });
    expect(r.success).toBe(true);
  });

  it('rejects scoring.maxSpeedWeight above 1', () => {
    const r = CastConfigInputSchema.safeParse({ presetId: 'responsive_accuracy', overrides: { scoring: { maxSpeedWeight: 1.5 } } });
    expect(r.success).toBe(false);
  });

  it('rejects negative scoring.maxSpeedWeight', () => {
    const r = CastConfigInputSchema.safeParse({ presetId: 'responsive_accuracy', overrides: { scoring: { maxSpeedWeight: -0.1 } } });
    expect(r.success).toBe(false);
  });

  it('accepts recording override with valid modality', () => {
    const r = CastConfigInputSchema.safeParse({
      presetId: 'responsive_accuracy',
      overrides: { recording: { enabled: true, modality: 'audio' } },
    });
    expect(r.success).toBe(true);
  });

  it('rejects recording override with unknown modality', () => {
    const r = CastConfigInputSchema.safeParse({
      presetId: 'responsive_accuracy',
      overrides: { recording: { modality: 'screen_capture' } },
    });
    expect(r.success).toBe(false);
  });

  it('accepts media override with externalImages policy', () => {
    const r = CastConfigInputSchema.safeParse({
      presetId: 'responsive_accuracy',
      overrides: { media: { externalImages: 'block', lazyLoadThemes: true } },
    });
    expect(r.success).toBe(true);
  });

  it('rejects media override with unknown externalImages value', () => {
    const r = CastConfigInputSchema.safeParse({
      presetId: 'responsive_accuracy',
      overrides: { media: { externalImages: 'always' } },
    });
    expect(r.success).toBe(false);
  });

  it('resolved snapshot includes recording/media defaults via SECTION_FILL', () => {
    const { config } = resolvePreset('responsive_accuracy', {});
    expect(config.recording).toBeDefined();
    expect(config.recording.enabled).toBe(false);
    expect(config.recording.modality).toBe('none');
    expect(config.media).toBeDefined();
    expect(config.media.externalImages).toBe('block');
    expect(config.scoring.maxSpeedWeight).toBeDefined();
  });
});

describe('Snapshot schema', () => {
  it('validates a fully resolved preset snapshot', () => {
    const { config } = resolvePreset('responsive_accuracy', {});
    const snapshot = {
      schemaVersion: 2,
      preset: { id: 'responsive_accuracy', version: 1, customized: false },
      source: { type: 'user', key: 'algebra_1', chunk: null },
      ...config,
      // Teams default — responsive_accuracy'da yo'q, snapshot required
      teams: { enabled: false, mode: 'individual_then_aggregate', assignment: 'random', count: 4, scoreAggregation: 'normalized_average' },
      participation: { delivery: 'in_room', paperCardMode: false },
      localization: { locale: 'uz-Latn', rtl: false },
      dataLifecycle: { policyId: 'institution_default_v1', retentionClass: 'standard' },
      resilience: { reconnectGraceMs: 120000, hostDisconnectGraceMs: 60000 },
      moderation: { publicChat: false, directMessages: false, openTextVisibility: 'host_review_first', questionWall: 'moderated', publicIdentity: 'safe_alias' },
      accessibility: { showQuestionOnDevice: true, highContrastAvailable: true, reducedMotionDefault: true, audioHasVisualEquivalent: true, keyboardDirector: true, screenReaderStatus: true },
      postCast: { actionPack: true, eventReplay: true, studentPrivateRecap: true, teacherReflection: true },
      ai: { cohostMode: 'off', mayExecuteLiveActions: false, teacherApprovalRequired: true },
    };
    const r = CastConfigSnapshotSchema.safeParse(snapshot);
    expect(r.success).toBe(true);
  });

  it('rejects snapshot with answer-key-like unknown fields', () => {
    const { config } = resolvePreset('responsive_accuracy', {});
    const bad = {
      schemaVersion: 2,
      preset: { id: 'responsive_accuracy', version: 1, customized: false },
      source: { type: 'user', key: 'k', chunk: null },
      ...config,
      secretAnswerKey: ['o_b'],
    };
    const r = CastConfigSnapshotSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });
});

describe('Canonical hash', () => {
  it('is deterministic for same config', () => {
    const a = hashConfig({ timer: { mode: 'soft', defaultSeconds: 30 }, scoring: { mode: 'accuracy' } });
    const b = hashConfig({ timer: { mode: 'soft', defaultSeconds: 30 }, scoring: { mode: 'accuracy' } });
    expect(a).toBe(b);
    expect(a.startsWith('sha256:')).toBe(true);
  });

  it('differs when config changes', () => {
    const a = hashConfig({ timer: { defaultSeconds: 30 } });
    const b = hashConfig({ timer: { defaultSeconds: 45 } });
    expect(a).not.toBe(b);
  });

  it('canonicalSerialize is key-sorted deterministic', () => {
    expect(canonicalSerialize({ b: 1, a: 2 })).toBe(canonicalSerialize({ a: 2, b: 1 }));
  });
});
