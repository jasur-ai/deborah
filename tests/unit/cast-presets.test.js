import { describe, it, expect } from 'vitest';
import { PRESET_REGISTRY, resolvePreset, DEFAULT_PRESET_ID, diffPreset } from '../../services/cast/presets.js';
import { CAST_PRESETS } from '../../utils/cast-constants.js';

describe('Preset registry', () => {
  it("has 6 presets (C4-06: minor_safe qo'shildi)", () => {
    expect(Object.keys(PRESET_REGISTRY)).toHaveLength(6);
    expect(PRESET_REGISTRY.minor_safe).toBeTruthy();
  });

  it('each preset has immutable metadata', () => {
    for (const p of Object.values(PRESET_REGISTRY)) {
      expect(p.id).toBeTruthy();
      expect(typeof p.version).toBe('number');
      expect(p.labelKey).toBeTruthy();
      expect(typeof p.recommended).toBe('boolean');
      expect(p.defaults).toBeTruthy();
    }
  });

  it('responsive_accuracy is default and recommended', () => {
    expect(DEFAULT_PRESET_ID).toBe(CAST_PRESETS.RESPONSIVE_ACCURACY);
    expect(PRESET_REGISTRY[CAST_PRESETS.RESPONSIVE_ACCURACY].recommended).toBe(true);
  });

  it('responsive accuracy defaults match contract', () => {
    const d = PRESET_REGISTRY[CAST_PRESETS.RESPONSIVE_ACCURACY].defaults;
    expect(d.pace).toBe('instructor');
    expect(d.playback.advanceMode).toBe('host_controlled');
    expect(d.timer.mode).toBe('soft');
    expect(d.timer.defaultSeconds).toBe(30);
    expect(d.scoring.mode).toBe('accuracy');
    expect(d.scoring.correctBase).toBe(1000);
    expect(d.scoring.speedBonusMax).toBe(0);
    expect(d.leaderboard.visibility).toBe('off_during_learning');
  });
});

describe('resolvePreset', () => {
  it('throws on unknown preset', () => {
    expect(() => resolvePreset('nope', {})).toThrow();
  });

  it('returns full config with defaults', () => {
    const { config, customized } = resolvePreset('responsive_accuracy', {});
    expect(config.timer.defaultSeconds).toBe(30);
    expect(customized).toBe(false);
  });

  it('merges overrides deep', () => {
    const { config, customized } = resolvePreset('responsive_accuracy', { timer: { defaultSeconds: 45 }, scoring: { mode: 'speed' } });
    expect(config.timer.defaultSeconds).toBe(45);
    expect(config.scoring.mode).toBe('speed');
    // untouched sibling preserved
    expect(config.timer.mode).toBe('soft');
    expect(customized).toBe(true);
  });

  it('does not mutate the base preset', () => {
    const baseTimer = JSON.stringify(PRESET_REGISTRY[CAST_PRESETS.RESPONSIVE_ACCURACY].defaults.timer);
    resolvePreset('responsive_accuracy', { timer: { defaultSeconds: 99 } });
    expect(JSON.stringify(PRESET_REGISTRY[CAST_PRESETS.RESPONSIVE_ACCURACY].defaults.timer)).toBe(baseTimer);
  });
});

describe('diffPreset', () => {
  it('returns empty diff for identical configs', () => {
    const base = PRESET_REGISTRY[CAST_PRESETS.RESPONSIVE_ACCURACY].defaults;
    const diff = diffPreset(base, JSON.parse(JSON.stringify(base)));
    expect(Object.keys(diff)).toHaveLength(0);
  });

  it('returns changed paths', () => {
    const base = PRESET_REGISTRY[CAST_PRESETS.RESPONSIVE_ACCURACY].defaults;
    const mod = JSON.parse(JSON.stringify(base));
    mod.timer.defaultSeconds = 60;
    const diff = diffPreset(base, mod);
    expect(diff['timer.defaultSeconds']).toEqual({ from: 30, to: 60 });
  });
});
