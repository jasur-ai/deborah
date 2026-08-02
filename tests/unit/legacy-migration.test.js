/**
 * Edikit — Legacy Migration Mapper Tests
 *
 * Covers: user mapping, test mapping, mock fan mapping, pre-group mapping,
 * result mapping, enrollment mapping, comprehensive analysis, report generation.
 *
 * All tests are PURE — they do not read/write any database or files.
 */

import { describe, it, expect } from 'vitest';

import {
  mapLegacyUser,
  mapLegacyTest,
  mapLegacyQuestions,
  mapLegacyMockFan,
  mapLegacyPreGroup,
  mapLegacyGameResult,
  mapLegacyEnrollment,
  analyzeLegacyData,
  generateDryRunReport,
  computeDataHash,
} from '../../src/modules/legacy-migration/index.js';

// ═══════════════════════════════════════════════════════════════════
// 1. USER MAPPING
// ═══════════════════════════════════════════════════════════════════

describe('Legacy Migration — Users', () => {
  describe('mapLegacyUser', () => {
    it('should map a regular user', () => {
      const result = mapLegacyUser('alisher', {
        username: 'Alisher',
        password: 'abc123hash',
        created_at: 1700000000000,
      });
      expect(result.mapped).toBeTruthy();
      expect(result.mapped.username).toBe('alisher');
      expect(result.mapped.role).toBe('student');
      expect(result.mapped.auth_provider).toBe('legacy');
      expect(result.warnings).toEqual([]);
    });

    it('should map admin user', () => {
      const result = mapLegacyUser('__admin__', {
        username: 'admin',
        password: 'hash456',
      });
      expect(result.mapped.username).toBe('admin');
      expect(result.mapped.role).toBe('institution_admin');
      expect(result.warnings).toContain('Admin user detected — will be migrated to institution_admin role');
    });

    it('should warn if no password hash', () => {
      const result = mapLegacyUser('nopass_user', { username: 'NoPass', password: null });
      expect(result.warnings).toContain('User has no password hash — will need credential reset');
    });

    it('should handle null input gracefully', () => {
      const result = mapLegacyUser('bad', null);
      expect(result.mapped).toBeNull();
    });

    it('should detect VIP status in metadata', () => {
      const result = mapLegacyUser('vipuser', {
        username: 'VIPUser',
        password: 'hash',
        isVip: true,
        vipGrantedBy: 'admin',
      });
      expect(result.mapped.metadata.isVip).toBe(true);
      expect(result.mapped.metadata.vipGrantedBy).toBe('admin');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. TEST MAPPING
// ═══════════════════════════════════════════════════════════════════

describe('Legacy Migration — Tests', () => {
  describe('mapLegacyTest', () => {
    it('should map a test with questions', () => {
      const test = {
        name: 'Algebra Test',
        created_at: 1700000000000,
        count: 2,
        questions: [
          { text: '2+2=?', options: ['3', '4', '5', '6'], correct: 1 },
          { text: 'Capital of Uzbekistan?', options: ['Tashkent', 'Samarkand', 'Bukhara', 'Khiva'], correct: 0 },
        ],
      };

      const result = mapLegacyTest('test_1', test, 'alisher');
      expect(result.mapped).toBeTruthy();
      expect(result.mapped.item_count).toBe(2);
      expect(result.mapped.owner).toBe('alisher');
      expect(result.mapped.items[0].private_key.correctKey).toBe('B'); // index 1 → B
      expect(result.mapped.items[0].public_content.stem).toBe('2+2=?');
      expect(result.mapped.items[0].question_type).toBe('multiple_choice');
    });

    it('should handle missing questions', () => {
      const result = mapLegacyTest('empty_test', { name: 'Empty' }, 'user');
      expect(result.mapped).toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should handle invalid questions gracefully', () => {
      const test = {
        name: 'Partial',
        questions: [
          { text: 'Valid question', options: ['A', 'B'], correct: 0 },
          null,
          { text: 'No options' },
        ],
      };
      const result = mapLegacyTest('partial', test, 'user');
      expect(result.mapped).toBeTruthy();
      expect(result.mapped.item_count).toBe(1); // Only valid one
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('mapLegacyQuestions', () => {
    it('should map fan-style questions', () => {
      const questions = [
        {
          num: 1, text: 'Test Q?', correctLetter: 'C', correctText: 'Correct Answer',
          options: [
            { text: 'A opt', letter: 'A', isCorrect: false },
            { text: 'B opt', letter: 'B', isCorrect: false },
            { text: 'C opt', letter: 'C', isCorrect: true },
            { text: 'D opt', letter: 'D', isCorrect: false },
          ],
        },
      ];

      const result = mapLegacyQuestions(questions, 'test_source');
      expect(result.items.length).toBe(1);
      expect(result.items[0].private_key.correctKey).toBe('C');
      expect(result.items[0].public_content.options.length).toBe(4);
    });

    it('should handle empty array', () => {
      const result = mapLegacyQuestions([], 'empty');
      expect(result.items).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. MOCK FAN MAPPING
// ═══════════════════════════════════════════════════════════════════

describe('Legacy Migration — Mock Fans', () => {
  describe('mapLegacyMockFan', () => {
    it('should map a mock fan with questions', () => {
      const fan = {
        name: 'Fizika — Mexanika',
        count: 2,
        createdAt: 1700000000000,
        questions: [
          { num: 1, text: 'Nyuton qonuni?', correctLetter: 'A', correctText: 'Inersiya',
            options: [
              { text: 'Inersiya', letter: 'A', isCorrect: true },
              { text: 'Dinamika', letter: 'B', isCorrect: false },
            ],
          },
        ],
      };

      const result = mapLegacyMockFan('fan_id', fan);
      expect(result.mapped).toBeTruthy();
      expect(result.mapped.legacy_source).toBe('mock_fan');
      expect(result.mapped.item_count).toBe(1);
      expect(result.mapped.name).toContain('Fizika');
    });

    it('should handle empty fan', () => {
      const result = mapLegacyMockFan('empty_fan', { name: 'Empty' });
      expect(result.mapped).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. PRE GROUP MAPPING
// ═══════════════════════════════════════════════════════════════════

describe('Legacy Migration — PRE Groups', () => {
  describe('mapLegacyPreGroup', () => {
    it('should map a pre-group with questions', () => {
      const group = {
        name: 'DTM — Matematika',
        group: 'pre_math',
        questions: [
          { num: 1, text: '2x+3=7 ?', correctLetter: 'C', correctText: 'x=2',
            options: [
              { text: 'x=1', letter: 'A', isCorrect: false },
              { text: 'x=3', letter: 'B', isCorrect: false },
              { text: 'x=2', letter: 'C', isCorrect: true },
            ],
          },
        ],
      };

      const result = mapLegacyPreGroup('pre_math', group);
      expect(result.mapped).toBeTruthy();
      expect(result.mapped.legacy_source).toBe('pre_group');
      expect(result.mapped.item_count).toBe(1);
      expect(result.mapped.group).toBe('pre_math');
    });

    it('should handle empty group', () => {
      const result = mapLegacyPreGroup('empty', null);
      expect(result.mapped).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. GAME RESULT MAPPING
// ═══════════════════════════════════════════════════════════════════

describe('Legacy Migration — Game Results', () => {
  describe('mapLegacyGameResult', () => {
    it('should map a game result with players', () => {
      const result = mapLegacyGameResult('result_1', {
        code: 'ABC12',
        testName: 'Math Quiz',
        players: { player1: { name: 'Player 1', emoji: '🦊' }, player2: { name: 'Player 2' } },
        scores: { player1: 85, player2: 70 },
        startedAt: 1700000000000,
        endedAt: 1700003600000,
        status: 'completed',
      });

      expect(result.mapped).toBeTruthy();
      expect(result.mapped.player_count).toBe(2);
      expect(result.mapped.players[0].score).toBe(85);
      expect(result.mapped.players[1].username).toBe('player2');
    });

    it('should handle empty result', () => {
      const result = mapLegacyGameResult('empty', null);
      expect(result.mapped).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. ENROLLMENT MAPPING
// ═══════════════════════════════════════════════════════════════════

describe('Legacy Migration — Enrollments', () => {
  describe('mapLegacyEnrollment', () => {
    it('should map an enrollment record', () => {
      const result = mapLegacyEnrollment('001_MATH101', {
        userId: '001',
        courseCode: 'MATH101',
        termCode: '2026-Fall',
        groupCode: 'A',
        status: 'active',
        source: 'roster',
        createdAt: 1700000000000,
      });

      expect(result.mapped).toBeTruthy();
      expect(result.mapped.user_id).toBe('001');
      expect(result.mapped.course_code).toBe('MATH101');
      expect(result.mapped.source).toBe('roster');
    });

    it('should handle missing userId', () => {
      const result = mapLegacyEnrollment('bad_enroll', { courseCode: 'PHY101' });
      expect(result.warnings).toContain('Enrollment missing userId');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. COMPREHENSIVE ANALYSIS
// ═══════════════════════════════════════════════════════════════════

describe('Legacy Migration — Comprehensive Analysis', () => {
  describe('analyzeLegacyData', () => {
    it('should analyze full legacy data structure', () => {
      const mockData = {
        users: {
          admin: { username: 'admin', password: 'hash' },
          user1: {
            username: 'User1', password: 'hash2',
            tests: {
              t1: {
                name: 'Test 1', count: 1,
                questions: [{ text: 'Q1', options: ['A', 'B'], correct: 0 }],
              },
            },
          },
        },
        mock_fans: {
          fan1: {
            name: 'Fan 1', count: 1, createdAt: 1700000000000,
            questions: [
              { num: 1, text: 'MQ?', correctLetter: 'A', correctText: 'A',
                options: [{ text: 'A', letter: 'A', isCorrect: true }],
              },
            ],
          },
        },
        pre_groups: {},
        results: {},
        enrollments: {},
        characters: {},
      };

      const analysis = analyzeLegacyData(mockData);
      expect(analysis.summary.total_users).toBe(2);
      expect(analysis.summary.total_tests).toBe(1);
      expect(analysis.summary.total_mock_fans).toBe(1);
      expect(analysis.summary.total_items_mapped).toBeGreaterThanOrEqual(2);
      expect(analysis.warnings).toBeDefined();
      expect(analysis.hash).toBeTruthy();
      expect(analysis.analyzed_at).toBeTruthy();
    });

    it('should handle empty data', () => {
      const analysis = analyzeLegacyData({});
      expect(analysis.summary.total_users).toBe(0);
    });

    it('should handle null data', () => {
      const analysis = analyzeLegacyData(null);
      expect(analysis.error).toBeTruthy();
    });

    it('should detect unexpected sections', () => {
      const analysis = analyzeLegacyData({
        users: {},
        mock_fans: {},
        pre_groups: {},
        results: {},
        enrollments: {},
        game_sessions: {},
        characters: {},
        unknown_section: { foo: 'bar' },
      });
      expect(analysis.summary.unmapped_sections).toContain('unknown_section');
    });

    it('should detect username collisions in quarantine', () => {
      const mockData = {
        users: {
          user1: { username: 'Duplicate', password: 'hash1' },
          user2: { username: 'duplicate', password: 'hash2' },
        },
        mock_fans: {},
        pre_groups: {},
        results: {},
        enrollments: {},
        characters: {},
      };

      const analysis = analyzeLegacyData(mockData);
      expect(analysis.quarantine).toBeDefined();
      expect(analysis.quarantine.duplicate_usernames.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect orphan tests in quarantine', () => {
      const mockData = {
        users: {
          testuser: {
            username: 'TestUser', password: 'hash',
            tests: {
              t1: {
                name: 'Test 1', count: 1,
                questions: [{ text: 'Q1', options: ['A', 'B'], correct: 0 }],
              },
            },
          },
        },
        mock_fans: {},
        pre_groups: {},
        results: {},
        enrollments: {},
        characters: {},
      };

      // Remove user to create orphan
      const orphanData = JSON.parse(JSON.stringify(mockData));
      delete orphanData.users;
      orphanData.users = { otheruser: { username: 'OtherUser', password: 'hash2' } };

      const analysis = analyzeLegacyData(orphanData);
      expect(analysis.quarantine.orphan_tests).toBeDefined();
    });

    it('should include roster analysis', () => {
      const mockData = {
        users: {},
        mock_fans: {},
        pre_groups: {},
        results: {},
        enrollments: {},
        characters: {},
        roster_staging: {
          session1: { rows: [{ name: 'Student1' }, { name: 'Student2' }], status: 'committed' },
        },
        roster_mappings: {
          map1: { columns: { name: 'Full Name' } },
        },
      };

      const analysis = analyzeLegacyData(mockData);
      expect(analysis.roster_analysis).toBeDefined();
      expect(analysis.roster_analysis.staging_session_count).toBe(1);
      expect(analysis.roster_analysis.total_staging_rows).toBe(2);
      expect(analysis.roster_analysis.committed_sessions).toBe(1);
      expect(analysis.roster_analysis.mapping_count).toBe(1);
    });

    it('should detect empty records in quarantine', () => {
      const mockData = {
        users: {},
        mock_fans: {
          emptyFan: { name: 'Empty Fan' },
        },
        pre_groups: {},
        results: {},
        enrollments: {},
        characters: {},
      };

      const analysis = analyzeLegacyData(mockData);
      expect(analysis.quarantine.empty_records.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. REPORT GENERATION
// ═══════════════════════════════════════════════════════════════════

describe('Legacy Migration — Report Generation', () => {
  describe('generateDryRunReport', () => {
    it('should generate a report from analysis', () => {
      const analysis = analyzeLegacyData({
        users: { testuser: { username: 'TestUser', password: 'hash' } },
        mock_fans: {},
        pre_groups: {},
        results: {},
        enrollments: {},
        characters: {},
      });

      const report = generateDryRunReport(analysis);
      expect(report).toContain('Edikit');
      expect(report).toContain('Migration Dry-Run');
      expect(report).toContain('1 users');
      expect(report).toContain('MIGRATION PLAN');
      expect(report).toContain('ROLLBACK PLAN');
    });

    it('should handle error state', () => {
      const report = generateDryRunReport({ error: 'Test error' });
      expect(report).toContain('ERROR');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. DATA HASH
// ═══════════════════════════════════════════════════════════════════

describe('Legacy Migration — Data Hash', () => {
  describe('computeDataHash', () => {
    it('should produce deterministic hash', () => {
      const data = { users: {}, mock_fans: {}, pre_groups: {}, results: {}, enrollments: {} };
      const hash1 = computeDataHash(data);
      const hash2 = computeDataHash(data);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA-256 hex
    });

    it('should return null for null data', () => {
      expect(computeDataHash(null)).toBeNull();
    });
  });
});
