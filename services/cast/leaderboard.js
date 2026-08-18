/**
 * Edikit — Cast Leaderboard Service
 * ----------------------------------
 * Deterministic ranking: ties → same rank, stable display order.
 * Privacy projections: top_n, personal_only, team_only.
 * Full private leaderboard hech qachon public Socket roomga chiqmaydi.
 */

/**
 * Build ranked entries (deterministic, tie-aware).
 *
 * @param {Array<{participantId:string, displayAlias:string, score:number, teamId?:string|null}>} rows
 * @returns {Array<{participantId, displayAlias, rank, score, teamId}>}
 */
export function rankEntries(rows) {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.participantId.localeCompare(b.participantId));
  const out = [];
  let lastScore = null;
  let lastRank = 0;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const rank = row.score === lastScore ? lastRank : i + 1;
    lastScore = row.score;
    lastRank = rank;
    out.push({ participantId: row.participantId, displayAlias: row.displayAlias, rank, score: row.score, teamId: row.teamId || null });
  }
  return out;
}

/**
 * Public Top-N projection — low ranks yashiriladi, exact score policy bo'yicha.
 */
export function publicTopN(ranked, { topN = 5, showExactScore = false }) {
  const visible = ranked.slice(0, topN);
  const hiddenCount = Math.max(0, ranked.length - visible.length);
  return {
    mode: 'top_n',
    entries: visible.map((e) => ({
      displayAlias: e.displayAlias,
      rank: e.rank,
      // showExactScore=false — privacy-safe: exact ball ochilmaydi (faqat o'rin)
      scoreDisplay: showExactScore ? String(e.score) : '',
    })),
    hiddenCount,
  };
}

/**
 * Personal projection — faqat o'z ranki + neighbors.
 */
export function personalProjection(ranked, participantId, neighborSpan = 1) {
  const idx = ranked.findIndex((e) => e.participantId === participantId);
  if (idx === -1) return null;
  const entry = ranked[idx];
  const start = Math.max(0, idx - neighborSpan);
  const end = Math.min(ranked.length, idx + neighborSpan + 1);
  const neighbors = ranked.slice(start, end).map((e) => e.rank);
  return {
    participantId,
    rank: entry.rank,
    neighbors,
    score: entry.score,
  };
}

/**
 * Team-only projection.
 */
export function teamProjection(ranked, teamById) {
  const teams = new Map();
  for (const e of ranked) {
    if (!e.teamId) continue;
    if (!teams.has(e.teamId)) {
      teams.set(e.teamId, { teamId: e.teamId, name: teamById?.[e.teamId]?.name || `Jamoa ${e.teamId}`, totalScore: 0, members: 0 });
    }
    const t = teams.get(e.teamId);
    t.totalScore += e.score;
    t.members++;
  }
  return [...teams.values()]
    .map((t) => ({ ...t, avgScore: t.members ? Math.round(t.totalScore / t.members) : 0 }))
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((t, i) => ({ teamId: t.teamId, name: t.name, rank: i + 1, score: t.totalScore, members: t.members }));
}

/**
 * Aggregate leaderboard from participants + scores records.
 */
export function buildLeaderboardFromStore(participants, scores) {
  const rows = [];
  for (const [pid, p] of Object.entries(participants || {})) {
    rows.push({
      participantId: pid,
      displayAlias: p.displayAlias || p.displayName || 'Ishtirokchi',
      score: scores?.[pid]?.total ?? 0,
      teamId: p.teamId || null,
    });
  }
  return rankEntries(rows);
}

// ── C4-01 Team Challenge ──

/**
 * Build a team-only leaderboard from per-member scores.
 * Aggregate policy: normalized_average (answered eligible members bo'yicha)
 * yoki sum_equal_size (equal-size guard director tomonidan tekshiriladi).
 *
 * @param {object} teams — {teamId: {teamId, name, memberIds, activeMemberCount}}
 * @param {object} scores — {pid: {total, answeredCount?, answered?}}
 * @param {object} teamsConfig — {scoreAggregation, tiePolicy, count}
 * @returns {Array<{teamId, name, score, rank, answeredEligible, members}>}
 */
export function buildTeamLeaderboard(teams = {}, scores = {}, teamsConfig = {}) {
  const rows = [];
  const singleDevice = teamsConfig?.mode === 'single_team_device';
  for (const [teamId, team] of Object.entries(teams)) {
    const members = team?.memberIds || [];
    const aggregation = teamsConfig?.scoreAggregation || 'normalized_average';
    let score = null;
    let answered = [];

    if (singleDevice) {
      // Score'lar responseOwnerId = teamId ostida (answer-service item 7)
      const s = scores[teamId] || { total: 0 };
      answered = (s.answeredCount ?? 0) > 0 || (s.total ?? 0) > 0 ? [teamId] : [];
      if (aggregation !== 'individual') score = answered.length ? (s.total || 0) : 0;
    } else {
      const memberScores = {};
      for (const pid of members) {
        memberScores[pid] = scores[pid] || { total: 0 };
      }
      answered = members.filter((pid) => {
        const s = scores[pid];
        return s && ((s.answeredCount ?? 0) > 0 || s.answered === true || (s.total ?? 0) > 0);
      });
      if (aggregation === 'individual') {
        score = null; // individual reytingda jamoa balli yo'q
      } else if (answered.length === 0) {
        score = 0;
      } else {
        const sum = answered.reduce((acc, pid) => acc + (scores[pid]?.total || 0), 0);
        score = aggregation === 'sum_equal_size' ? sum : Math.round(sum / answered.length);
      }
    }

    rows.push({
      teamId,
      name: team?.name || `Jamoa ${teamId.replace(/^team_/, '')}`,
      score,
      answeredEligible: answered.length,
      members,
      activeMemberCount: team?.activeMemberCount ?? members.length,
    });
  }
  return rankTeams(rows, teamsConfig?.tiePolicy);
}

/**
 * Tie-aware team ranking.
 * tiePolicy: first_answered (default) | alphabetical | same_rank
 */
export function rankTeams(rows, tiePolicy = 'first_answered') {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const s = (b.score ?? 0) - (a.score ?? 0);
    if (s !== 0) return s;
    if (tiePolicy === 'alphabetical') return String(a.name).localeCompare(String(b.name));
    if (tiePolicy === 'same_rank') return a.teamId.localeCompare(b.teamId);
    // first_answered: ko'proq javob bergan jamoa oldinda (tezroq to'plagan)
    return (b.answeredEligible ?? 0) - (a.answeredEligible ?? 0) || a.teamId.localeCompare(b.teamId);
  });
  const out = [];
  let lastScore = null;
  let lastRank = 0;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const rank = (r.score ?? 0) === lastScore ? lastRank : i + 1;
    lastScore = r.score ?? 0;
    lastRank = rank;
    out.push({ ...r, rank });
  }
  return out;
}

/**
 * Public team-only leaderboard projection (projector / shared display).
 * Member IDs va individual scores yashiriladi.
 */
export function teamOnlyProjection(teamLeaderboard, { topN = 8, showExactScore = true } = {}) {
  return {
    mode: 'team_only',
    entries: (teamLeaderboard || []).slice(0, topN).map((t) => ({
      teamId: t.teamId,
      name: t.name,
      rank: t.rank,
      scoreDisplay: showExactScore ? String(t.score ?? 0) : '***',
      answeredEligible: t.answeredEligible,
    })),
    hiddenCount: Math.max(0, (teamLeaderboard?.length || 0) - topN),
  };
}
