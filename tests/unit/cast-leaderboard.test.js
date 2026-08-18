import { describe, it, expect } from 'vitest';
import { rankEntries, publicTopN, personalProjection, teamProjection, buildLeaderboardFromStore } from '../../services/cast/leaderboard.js';

const rows = [
  { participantId: 'p_a', displayAlias: 'Ali', score: 1000, teamId: 't1' },
  { participantId: 'p_b', displayAlias: 'Bek', score: 1000, teamId: 't1' },
  { participantId: 'p_c', displayAlias: 'Sam', score: 800, teamId: 't2' },
  { participantId: 'p_d', displayAlias: 'Dil', score: 500, teamId: 't2' },
  { participantId: 'p_e', displayAlias: 'Esh', score: 300, teamId: null },
];

describe('rankEntries', () => {
  it('ties get same rank', () => {
    const ranked = rankEntries(rows);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(1); // tie with p_a
    expect(ranked[2].rank).toBe(3);
  });

  it('sorts desc by score', () => {
    const ranked = rankEntries(rows);
    expect(ranked[0].score).toBe(1000);
    expect(ranked[ranked.length - 1].score).toBe(300);
  });

  it('stable display order breaks ties deterministically', () => {
    const a = rankEntries(rows);
    const b = rankEntries(rows);
    expect(a.map((e) => e.participantId)).toEqual(b.map((e) => e.participantId));
  });
});

describe('publicTopN', () => {
  it('hides low ranks and counts them', () => {
    const ranked = rankEntries(rows);
    const t = publicTopN(ranked, { topN: 3, showExactScore: false });
    expect(t.entries).toHaveLength(3);
    expect(t.hiddenCount).toBe(2);
  });

  it('privacy: exact score hidden when showExactScore=false (STYLE S32.02)', () => {
    const ranked = rankEntries(rows);
    const t = publicTopN(ranked, { topN: 5, showExactScore: false });
    for (const e of t.entries) {
      expect(e.scoreDisplay).toBe('');
      expect(e.score).toBeUndefined();
    }
    const exact = publicTopN(ranked, { topN: 5, showExactScore: true });
    expect(exact.entries[0].scoreDisplay).toBe(String(rows[0].score));
  });

  it('boundary includes all when fewer than topN', () => {
    const ranked = rankEntries(rows.slice(0, 2));
    const t = publicTopN(ranked, { topN: 5 });
    expect(t.hiddenCount).toBe(0);
  });
});

describe('personalProjection', () => {
  it('returns own rank + neighbors', () => {
    const ranked = rankEntries(rows);
    const p = personalProjection(ranked, 'p_d', 1);
    expect(p.rank).toBe(4);
    expect(p.neighbors).toContain(3);
    expect(p.neighbors).toContain(4);
    expect(p.neighbors).toContain(5);
  });

  it('returns null for unknown participant', () => {
    expect(personalProjection(rankEntries(rows), 'nope')).toBeNull();
  });
});

describe('teamProjection', () => {
  it('aggregates by team and ranks', () => {
    const ranked = rankEntries(rows);
    const teamById = { t1: { name: 'Yulduzlar' }, t2: { name: 'Bilimdonlar' } };
    const teams = teamProjection(ranked, teamById);
    expect(teams).toHaveLength(2);
    expect(teams[0].name).toBe('Yulduzlar'); // higher total
    expect(teams[0].members).toBe(2);
    expect(teams[1].members).toBe(2);
  });
});

describe('buildLeaderboardFromStore', () => {
  it('joins participants + scores', () => {
    const participants = {
      p_1: { displayAlias: 'Ali' },
      p_2: { displayAlias: 'Bek' },
    };
    const scores = { p_1: { total: 2000 }, p_2: { total: 1000 } };
    const lb = buildLeaderboardFromStore(participants, scores);
    expect(lb[0].participantId).toBe('p_1');
    expect(lb[0].score).toBe(2000);
    expect(lb[1].displayAlias).toBe('Bek');
  });
});
