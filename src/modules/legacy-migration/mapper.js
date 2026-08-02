/**
 * Edikit — Legacy Data Migration Mapper
 *
 * Maps legacy Firebase/JSON data structures to the PostgreSQL canonical schema.
 * All functions are PURE — they do NOT write to any database.
 * Results are returned as structured reports for dry-run validation.
 *
 * Legacy source paths (from firebase/seed-data.js and data/db.json):
 *   users/{username}              → PostgreSQL users table
 *   users/{username}/tests/{id}   → item_bank + item_versions
 *   mock_fans/{fanId}             → item_bank + item_versions
 *   pre_groups/{groupId}          → assessment_assignments + items
 *   game_sessions/{code}          → attempts + responses
 *   results/{resultId}            → grades
 *   enrollments/{enrollmentId}    → enrollments table
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// 1. LEGACY USER MAPPING
// ═══════════════════════════════════════════════════════════════════

/**
 * Map a legacy user record to PostgreSQL canonical user format.
 *
 * Legacy format:
 *   users/{key}: { username, password, created_at, tests: {}, isVip, ... }
 *
 * Target format:
 *   users: { username, password_hash, auth_provider, display_name, created_at, metadata }
 *
 * @param {string} userKey - Legacy key (e.g., "alisher", "user", "__admin__")
 * @param {Object} legacyUser - Legacy user data from db.json
 * @returns {Object} Canonical user record + warnings
 */
export function mapLegacyUser(userKey, legacyUser) {
  if (!legacyUser || typeof legacyUser !== 'object') {
    return { mapped: null, warnings: ['Invalid user record — skipped'] };
  }

  const warnings = [];
  const displayName = legacyUser.username || userKey;
  const isAdmin = userKey === '__admin__';

  const canonical = {
    legacy_key: userKey,
    username: isAdmin ? 'admin' : (legacyUser.username || userKey).toLowerCase().replace(/[.#$\/\[\]]/g, '_'),
    display_name: displayName,
    password_hash: legacyUser.password || null,
    auth_provider: 'legacy',
    external_id: userKey,
    role: isAdmin ? 'institution_admin' : 'student',
    created_at: legacyUser.created_at ? new Date(legacyUser.created_at).toISOString() : null,
    metadata: {
      legacy: true,
      isVip: !!legacyUser.isVip,
      vipGrantedBy: legacyUser.vipGrantedBy || null,
      migratedFrom: userKey,
    },
  };

  if (!legacyUser.password) {
    warnings.push('User has no password hash — will need credential reset');
  }

  // Check for orphan tests
  const testCount = legacyUser.tests ? Object.keys(legacyUser.tests).length : 0;
  if (testCount > 0) {
    canonical.metadata.testCount = testCount;
  }

  // Record admin warning
  if (isAdmin) {
    warnings.push('Admin user detected — will be migrated to institution_admin role');
  }

  return { mapped: canonical, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// 2. LEGACY TEST → ITEM MAPPING
// ═══════════════════════════════════════════════════════════════════

/**
 * Map a legacy user's test to PostgreSQL item_bank + item_versions format.
 *
 * Legacy format (inside users/{key}/tests/{testId}):
 *   { name, created_at, count, questions: [{ text, options: [...], correct }] }
 *
 * Target:
 *   item_bank: { legacy_source, name, item_count, owner_username, created_at }
 *   item_versions: [{ public_content: { stem, options }, private_key: { correct } }]
 *
 * @param {string} testId - Legacy test ID (e.g., "ut1", "test_0")
 * @param {Object} legacyTest - Legacy test data
 * @param {string} ownerUsername - Username of test owner
 * @returns {Object} Mapped items + warnings
 */
export function mapLegacyTest(testId, legacyTest, ownerUsername) {
  if (!legacyTest || !legacyTest.questions) {
    return { mapped: null, warnings: ['No questions in test — skipped'] };
  }

  const warnings = [];
  const questions = Array.isArray(legacyTest.questions) ? legacyTest.questions : [];
  const items = [];
  let invalidCount = 0;

  questions.forEach((q, idx) => {
    if (!q || !q.text || !Array.isArray(q.options)) {
      invalidCount++;
      return;
    }

    const options = q.options.map((opt, i) => ({
      key: String.fromCharCode(65 + i),
      text: String(opt),
      isCorrect: q.correct === i,
    }));

    const correctKey = String.fromCharCode(65 + (q.correct || 0));

    items.push({
      public_content: {
        stem: String(q.text),
        options: options.map(o => ({ key: o.key, text: o.text })),
      },
      private_key: {
        correctKey,
        correctIndex: q.correct,
      },
      question_type: 'multiple_choice',
      difficulty: 'medium',
      metadata: {
        legacyTestId: testId,
        legacyIndex: idx,
      },
    });
  });

  if (invalidCount > 0) {
    warnings.push(`${invalidCount} invalid questions found — excluded from mapping`);
  }

  const mapped = {
    legacy_test_id: testId,
    name: legacyTest.name || `Migrated: ${testId}`,
    owner: ownerUsername || 'unknown',
    item_count: items.length,
    created_at: legacyTest.created_at ? new Date(legacyTest.created_at).toISOString() : null,
    items,
    status: items.length > 0 ? 'mapped' : 'empty',
  };

  return { mapped, warnings };
}

/**
 * Map legacy questions array to canonical items list.
 * Used for mock_fans and pre_groups which use a different question format.
 *
 * Legacy fan question:
 *   { num, text, correctLetter, correctText, options: [{ text, letter, isCorrect }] }
 *
 * @param {Array} legacyQuestions
 * @param {string} sourceLabel - Label for error messages
 * @returns {Object} { items, warnings }
 */
export function mapLegacyQuestions(legacyQuestions, sourceLabel = 'unknown') {
  if (!Array.isArray(legacyQuestions)) {
    return { items: [], warnings: ['No questions array — skipped'] };
  }

  const warnings = [];
  const items = [];
  let invalidCount = 0;

  legacyQuestions.forEach((q, idx) => {
    if (!q || !q.text || !Array.isArray(q.options)) {
      invalidCount++;
      return;
    }

    const options = q.options.map(opt => ({
      key: (opt.letter || String.fromCharCode(65 + idx)).toUpperCase(),
      text: String(opt.text || ''),
      isCorrect: !!opt.isCorrect,
    }));

    items.push({
      public_content: {
        stem: String(q.text),
        options: options.map(o => ({ key: o.key, text: o.text })),
      },
      private_key: {
        correctKey: (q.correctLetter || options.find(o => o.isCorrect)?.key || 'A').toUpperCase(),
      },
      question_type: 'multiple_choice',
      difficulty: 'medium',
      metadata: {
        legacySource: sourceLabel,
        legacyIndex: idx,
        legacyNum: q.num,
      },
    });
  });

  if (invalidCount > 0) {
    warnings.push(`${invalidCount} invalid questions in ${sourceLabel}`);
  }

  return { items, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// 3. MOCK FAN MAPPING
// ═══════════════════════════════════════════════════════════════════

/**
 * Map a mock fan (pre-made test collection) to item bank format.
 *
 * Legacy format:
 *   mock_fans/{fanId}: { name, count, createdAt, questions: [...] }
 *
 * @param {string} fanId
 * @param {Object} legacyFan
 * @returns {Object} Mapped item bank + warnings
 */
export function mapLegacyMockFan(fanId, legacyFan) {
  if (!legacyFan || !legacyFan.questions) {
    return { mapped: null, warnings: ['Empty mock fan — skipped'] };
  }

  const warnings = [];
  const { items, warnings: qWarnings } = mapLegacyQuestions(legacyFan.questions, `mock_fan:${fanId}`);
  warnings.push(...qWarnings);

  const mapped = {
    legacy_source: 'mock_fan',
    legacy_id: fanId,
    name: legacyFan.name || `Mock: ${fanId}`,
    item_count: items.length,
    created_at: legacyFan.createdAt ? new Date(legacyFan.createdAt).toISOString() : null,
    items,
    status: items.length > 0 ? 'mapped' : 'empty',
  };

  return { mapped, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// 4. PRE GROUP MAPPING
// ═══════════════════════════════════════════════════════════════════

/**
 * Map a PRE test group to assessment format.
 *
 * Legacy format:
 *   pre_groups/{groupId}: { name, group, questions: [...] }
 *
 * @param {string} groupId
 * @param {Object} legacyGroup
 * @returns {Object} Mapped group + warnings
 */
export function mapLegacyPreGroup(groupId, legacyGroup) {
  if (!legacyGroup) {
    return { mapped: null, warnings: ['Empty pre-group — skipped'] };
  }

  const warnings = [];
  const questions = legacyGroup.questions || [];
  const { items, warnings: qWarnings } = mapLegacyQuestions(questions, `pre_group:${groupId}`);
  warnings.push(...qWarnings);

  const subtestCount = legacyGroup.subtests ? Object.keys(legacyGroup.subtests).length : 0;

  const mapped = {
    legacy_source: 'pre_group',
    legacy_id: groupId,
    name: legacyGroup.name || `PRE: ${groupId}`,
    group: legacyGroup.group || null,
    item_count: items.length,
    subtest_count: subtestCount,
    items,
    status: items.length > 0 ? 'mapped' : 'empty',
  };

  return { mapped, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// 5. GAME RESULT MAPPING
// ═══════════════════════════════════════════════════════════════════

/**
 * Map a game session result to attempt/grade format.
 *
 * Legacy format:
 *   results/{resultId}: { code, players, scores, startedAt, endedAt, questions, answers }
 *   game_sessions/{code}: { players, state, questions, answers }
 *
 * @param {string} resultId
 * @param {Object} legacyResult
 * @returns {Object} Mapped result + warnings
 */
export function mapLegacyGameResult(resultId, legacyResult) {
  if (!legacyResult) {
    return { mapped: null, warnings: ['Empty result — skipped'] };
  }

  const warnings = [];
  const players = legacyResult.players || legacyResult.playerList || {};
  const scores = legacyResult.scores || legacyResult.playerScores || {};

  const playerResults = Object.keys(players).map(playerName => ({
    username: playerName,
    display_name: players[playerName]?.name || playerName,
    score: scores[playerName] || 0,
    emoji: players[playerName]?.emoji || null,
  }));

  const mapped = {
    legacy_id: resultId,
    code: legacyResult.code || resultId,
    test_name: legacyResult.testName || 'Unknown',
    question_count: legacyResult.questions ? (Array.isArray(legacyResult.questions) ? legacyResult.questions.length : 0) : 0,
    player_count: playerResults.length,
    players: playerResults,
    started_at: legacyResult.startedAt ? new Date(legacyResult.startedAt).toISOString() : null,
    ended_at: legacyResult.endedAt ? new Date(legacyResult.endedAt).toISOString() : null,
    status: legacyResult.status || 'completed',
  };

  if (playerResults.length === 0) {
    warnings.push('No player data in result');
  }

  return { mapped, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// 6. ENROLLMENT MAPPING
// ═══════════════════════════════════════════════════════════════════

/**
 * Map legacy enrollment data to canonical format.
 *
 * Legacy format:
 *   enrollments/{key}: { id, userId, courseCode, termCode, groupCode, status, source, createdAt }
 *
 * @param {string} enrollmentKey
 * @param {Object} legacyEnrollment
 * @returns {Object} Mapped enrollment + warnings
 */
export function mapLegacyEnrollment(enrollmentKey, legacyEnrollment) {
  if (!legacyEnrollment) {
    return { mapped: null, warnings: ['Empty enrollment — skipped'] };
  }

  const warnings = [];

  const mapped = {
    legacy_key: enrollmentKey,
    user_id: legacyEnrollment.userId || legacyEnrollment.id || enrollmentKey,
    course_code: legacyEnrollment.courseCode || '',
    term_code: legacyEnrollment.termCode || '',
    group_code: legacyEnrollment.groupCode || '',
    status: legacyEnrollment.status || 'active',
    source: legacyEnrollment.source || 'legacy_migration',
    created_at: legacyEnrollment.createdAt ? new Date(legacyEnrollment.createdAt).toISOString() : null,
    metadata: { legacy: true, legacyKey: enrollmentKey },
  };

  if (!legacyEnrollment.userId) {
    warnings.push('Enrollment missing userId');
  }

  return { mapped, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// 7. COMPREHENSIVE DATA ANALYSIS
// ═══════════════════════════════════════════════════════════════════

/**
 * Analyze all legacy data from db.json and produce structured mapping results.
 * This is the MAIN entry point for the dry-run report.
 *
 * DOES NOT WRITE TO DATABASE — only analyzes and returns mapping plans.
 *
 * @param {Object} legacyData - The full db.json object
 * @returns {Object} Complete analysis with all mapping plans, warnings, and stats
 */
export function analyzeLegacyData(legacyData) {
  if (!legacyData || typeof legacyData !== 'object') {
    return { error: 'Invalid legacy data', sections: {}, summary: {}, warnings: ['No data provided'] };
  }

  const results = {
    users: [],
    tests: [],
    mock_fans: [],
    pre_groups: [],
    results: [],
    enrollments: [],
  };

  const allWarnings = [];
  let totalItemsMapped = 0;

  // ── Users (key-value flat structure) ──
  const legacyUsers = legacyData.users || {};
  const userKeys = Object.keys(legacyUsers);
  for (const key of userKeys) {
    const { mapped, warnings } = mapLegacyUser(key, legacyUsers[key]);
    if (mapped) {
      results.users.push(mapped);
      allWarnings.push(...warnings.map(w => `[User:${key}] ${w}`));
    } else {
      allWarnings.push(`[User:${key}] Failed to map`);
    }
  }

  // ── User tests (nested under users) ──
  for (const key of userKeys) {
    const user = legacyUsers[key];
    if (!user || !user.tests) continue;
    const testKeys = Object.keys(user.tests);
    const username = user.username || key;

    for (const testKey of testKeys) {
      const { mapped, warnings } = mapLegacyTest(testKey, user.tests[testKey], username);
      if (mapped) {
        results.tests.push(mapped);
        totalItemsMapped += mapped.item_count;
        allWarnings.push(...warnings.map(w => `[Test:${key}/${testKey}] ${w}`));
      }
    }
  }

  // ── Mock fans ──
  const legacyFans = legacyData.mock_fans || {};
  for (const fanId of Object.keys(legacyFans)) {
    const { mapped, warnings } = mapLegacyMockFan(fanId, legacyFans[fanId]);
    if (mapped) {
      results.mock_fans.push(mapped);
      totalItemsMapped += mapped.item_count;
      allWarnings.push(...warnings.map(w => `[MockFan:${fanId}] ${w}`));
    }
  }

  // ── PRE groups ──
  const legacyPreGroups = legacyData.pre_groups || {};
  for (const groupId of Object.keys(legacyPreGroups)) {
    const { mapped, warnings } = mapLegacyPreGroup(groupId, legacyPreGroups[groupId]);
    if (mapped) {
      results.pre_groups.push(mapped);
      totalItemsMapped += mapped.item_count;
      allWarnings.push(...warnings.map(w => `[PreGroup:${groupId}] ${w}`));
    }
  }

  // ── Game results ──
  const legacyResults = legacyData.results || {};
  for (const resultId of Object.keys(legacyResults)) {
    const { mapped, warnings } = mapLegacyGameResult(resultId, legacyResults[resultId]);
    if (mapped) {
      results.results.push(mapped);
      allWarnings.push(...warnings.map(w => `[Result:${resultId}] ${w}`));
    }
  }

  // ── Enrollments ──
  const legacyEnrollments = legacyData.enrollments || {};
  for (const enrollmentKey of Object.keys(legacyEnrollments)) {
    const { mapped, warnings } = mapLegacyEnrollment(enrollmentKey, legacyEnrollments[enrollmentKey]);
    if (mapped) {
      results.enrollments.push(mapped);
      allWarnings.push(...warnings.map(w => `[Enrollment:${enrollmentKey}] ${w}`));
    }
  }

  // ── Quarantine: detect invalid/orphan/duplicate records ──
  const quarantine = {
    orphan_tests: [],
    duplicate_usernames: [],
    invalid_questions: [],
    empty_records: [],
  };

  // Username collision detection
  const usernameMap = new Map(); // normalized → count
  for (const u of results.users) {
    const norm = u.username.toLowerCase();
    usernameMap.set(norm, (usernameMap.get(norm) || 0) + 1);
  }
  for (const [username, count] of usernameMap.entries()) {
    if (count > 1) {
      quarantine.duplicate_usernames.push({ username, count });
      allWarnings.push(`Duplicate username detected: "${username}" appears ${count} times`);
    }
  }

  // Orphan test detection (test owner not found in migrated users)
  const migratedUsernames = new Set(results.users.map(u => u.username));
  for (const test of results.tests) {
    if (!migratedUsernames.has(test.owner)) {
      quarantine.orphan_tests.push({ testId: test.legacy_test_id, owner: test.owner });
      allWarnings.push(`Orphan test: "${test.legacy_test_id}" — owner "${test.owner}" not found in migrated users`);
    }
  }

  // Invalid/empty item detection — check ORIGINAL data, not mapped results
  for (const test of results.tests) {
    if (test.status === 'empty') {
      quarantine.empty_records.push({ type: 'test', id: test.legacy_test_id });
    }
    if (test.items) {
      const invalids = test.items.filter(i => !i.public_content?.stem);
      if (invalids.length > 0) {
        quarantine.invalid_questions.push({ source: `test:${test.legacy_test_id}`, count: invalids.length });
      }
    }
  }
  // Detect empty mock fans from ORIGINAL data (skipped by mapper)
  for (const [fanId, fan] of Object.entries(legacyFans)) {
    if (!fan || !fan.questions || !Array.isArray(fan.questions) || fan.questions.length === 0) {
      quarantine.empty_records.push({ type: 'mock_fan', id: fanId });
    }
  }
  // Detect empty pre-groups from ORIGINAL data
  for (const [groupId, group] of Object.entries(legacyPreGroups)) {
    if (!group || !group.questions || !Array.isArray(group.questions) || group.questions.length === 0) {
      quarantine.empty_records.push({ type: 'pre_group', id: groupId });
    }
  }

  // ── Roster staging analysis ──
  const rosterStaging = legacyData.roster_staging || {};
  const rosterMappings = legacyData.roster_mappings || {};
  const rosterAnalysis = {
    staging_session_count: Object.keys(rosterStaging).length,
    mapping_count: Object.keys(rosterMappings).length,
    total_staging_rows: 0,
    committed_sessions: 0,
  };
  for (const session of Object.values(rosterStaging)) {
    if (session.rows) rosterAnalysis.total_staging_rows += session.rows.length;
    if (session.status === 'committed') rosterAnalysis.committed_sessions++;
  }

  // ── Summary statistics ──
  const summary = {
    total_users: results.users.length,
    total_tests: results.tests.length,
    total_mock_fans: results.mock_fans.length,
    total_pre_groups: results.pre_groups.length,
    total_results: results.results.length,
    total_enrollments: results.enrollments.length,
    total_items_mapped: totalItemsMapped,
    total_warnings: allWarnings.length,
    total_quarantine_items: quarantine.orphan_tests.length + quarantine.duplicate_usernames.length + quarantine.invalid_questions.length + quarantine.empty_records.length,
    unmapped_sections: [],
  };

  // Check for unexpected sections
  const knownSections = ['users', 'mock_fans', 'pre_groups', 'results', 'game_sessions', 'characters', 'enrollments', 'roster_staging', 'roster_mappings'];
  const unexpectedSections = Object.keys(legacyData).filter(s => !knownSections.includes(s));
  if (unexpectedSections.length > 0) {
    summary.unmapped_sections = unexpectedSections;
    allWarnings.push(`Unexpected sections found: ${unexpectedSections.join(', ')}`);
  }

  // ── Compute data hash for parity check ──
  const hash = computeDataHash(legacyData);

  return {
    sections: results,
    summary,
    warnings: allWarnings,
    quarantine,
    roster_analysis: rosterAnalysis,
    hash,
    analyzed_at: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// 8. DRY-RUN REPORT GENERATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a human-readable dry-run report from the analysis results.
 *
 * @param {Object} analysis - Result from analyzeLegacyData()
 * @returns {string} Formatted report text
 */
export function generateDryRunReport(analysis) {
  if (!analysis || analysis.error) {
    return `MIGRATION DRY-RUN REPORT\n${'='.repeat(50)}\nERROR: ${analysis?.error || 'No data'}\n`;
  }

  const { sections, summary, warnings, hash } = analysis;
  const lines = [];

  lines.push('╔═══════════════════════════════════════════════════════════════╗');
  lines.push('║        Edikit — Legacy JSON/Firebase Migration Dry-Run       ║');
  lines.push('╚═══════════════════════════════════════════════════════════════╝');
  lines.push('');

  // ── Summary ──
  lines.push('─── SUMMARY ───');
  lines.push(`  Date/Time:            ${analysis.analyzed_at}`);
  lines.push(`  Data Hash (SHA-256):  ${hash ? hash.substring(0, 16) + '...' : 'N/A'}`);
  lines.push('');
  lines.push('  Legacy Records Found:');
  lines.push(`    Users:               ${summary.total_users}`);
  lines.push(`    User Tests (items):  ${summary.total_tests} (${summary.total_tests > 0 ? sections.tests.reduce((s, t) => s + t.item_count, 0) : 0} total questions)`);
  lines.push(`    Mock Fans:           ${summary.total_mock_fans} (${summary.total_mock_fans > 0 ? sections.mock_fans.reduce((s, f) => s + f.item_count, 0) : 0} total questions)`);
  lines.push(`    PRE Groups:          ${summary.total_pre_groups} (${summary.total_pre_groups > 0 ? sections.pre_groups.reduce((s, g) => s + g.item_count, 0) : 0} total questions)`);
  lines.push(`    Game Results:        ${summary.total_results}`);
  lines.push(`    Enrollments:         ${summary.total_enrollments}`);
  lines.push('');
  lines.push(`  Total Items Mapped:   ${summary.total_items_mapped}`);
  lines.push(`  Total Warnings:       ${summary.total_warnings}`);
  if (summary.unmapped_sections.length > 0) {
    lines.push(`  ⚠️  Unmapped Sections:  ${summary.unmapped_sections.join(', ')}`);
  }
  lines.push('');

  // ── Quarantine ──
  if (analysis.quarantine) {
    const q = analysis.quarantine;
    const totalQ = summary.total_quarantine_items || 0;
    if (totalQ > 0) {
      lines.push('─── QUARANTINE REPORT ───');
      lines.push(`  Total quarantined: ${totalQ} records`);
      if (q.duplicate_usernames.length > 0) {
        q.duplicate_usernames.forEach(d => lines.push(`  ⛔ Duplicate username: "${d.username}" appears ${d.count} times`));
      }
      if (q.orphan_tests.length > 0) {
        q.orphan_tests.forEach(o => lines.push(`  ⛔ Orphan test: "${o.testId}" (owner: ${o.owner})`));
      }
      if (q.invalid_questions.length > 0) {
        q.invalid_questions.forEach(i => lines.push(`  ⛔ Invalid questions: ${i.source} — ${i.count} items`));
      }
      if (q.empty_records.length > 0) {
        q.empty_records.forEach(e => lines.push(`  ⛔ Empty record: ${e.type} — ${e.id}`));
      }
      lines.push('  Manual review required before production migration.');
      lines.push('');
    }
  }

  // ── Roster Staging ──
  if (analysis.roster_analysis) {
    const r = analysis.roster_analysis;
    if (r.staging_session_count > 0 || r.mapping_count > 0) {
      lines.push('─── ROSTER STAGING ───');
      lines.push(`  Staging sessions:     ${r.staging_session_count}`);
      lines.push(`  Total staging rows:   ${r.total_staging_rows}`);
      lines.push(`  Committed sessions:   ${r.committed_sessions}`);
      lines.push(`  Saved mappings:       ${r.mapping_count}`);
      lines.push('');
    }
  }

  // ── Users ──
  lines.push('─── USERS ───');
  lines.push(`  ${summary.total_users} users to migrate`);
  const adminUser = sections.users.find(u => u.role === 'institution_admin');
  if (adminUser) lines.push(`  ⚡ 1 admin user (${adminUser.username}) → institution_admin role`);
  lines.push('');

  // ── Questions ──
  const allQuestions = [
    ...sections.tests.flatMap(t => t.items || []),
    ...sections.mock_fans.flatMap(f => f.items || []),
    ...sections.pre_groups.flatMap(g => g.items || []),
  ];
  const privateQuestions = allQuestions.filter(q => q.private_key);
  const publicQuestions = allQuestions.filter(q => q.public_content);

  lines.push('─── QUESTION MAPPING ───');
  lines.push(`  Total Questions:       ${allQuestions.length}`);
  lines.push(`  Public DTO Ready:      ${publicQuestions.length}`);
  lines.push(`  Private Key Ready:     ${privateQuestions.length}`);
  lines.push(`  Type:                  ${allQuestions.length > 0 ? allQuestions[0].question_type : 'N/A'}`);
  lines.push('');

  // ── Warnings ──
  if (warnings.length > 0) {
    lines.push('─── WARNINGS ───');
    warnings.slice(0, 20).forEach(w => lines.push(`  ⚠️  ${w}`));
    if (warnings.length > 20) {
      lines.push(`  ... and ${warnings.length - 20} more warnings`);
    }
    lines.push('');
  }

  // ── Recommendations ──
  lines.push('─── MIGRATION PLAN ───');
  lines.push('  Phase 1: Users + Tests → PostgreSQL users + item_bank + item_versions');
  lines.push('  Phase 2: Mock Fans + PRE Groups → item_bank + assessment_templates');
  lines.push('  Phase 3: Game Results → attempts + responses + grades');
  lines.push('  Phase 4: Enrollments → enrollments table');
  lines.push('  Phase 5: Validate parity, quarantine orphans, archive originals');
  lines.push('');

  // ── Rollback Plan ──
  lines.push('─── ROLLBACK PLAN ───');
  lines.push('  Pre-migration: Full backup of data/db.json + pg_dump');
  lines.push('  Dual-read: Keep both Firebase and PostgreSQL active during Phase 1');
  lines.push('  Rollback: Delete migrated records from PostgreSQL, restore from backup');
  lines.push('');

  lines.push(`─── END OF REPORT (Hash: ${hash ? hash.substring(0, 16) : 'N/A'}) ───`);

  return lines.join('\n');
}

/**
 * Compute a deterministic hash of the entire legacy dataset for parity checking.
 *
 * @param {Object} legacyData
 * @returns {string} SHA-256 hex hash
 */
export function computeDataHash(legacyData) {
  if (!legacyData) return null;
  try {
    const serialized = JSON.stringify(legacyData, Object.keys(legacyData).sort());
    return crypto.createHash('sha256').update(serialized).digest('hex');
  } catch (_) {
    return null;
  }
}
