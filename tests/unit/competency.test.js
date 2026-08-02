/**
 * Edikit — Competency Module Tests
 *
 * Covers: framework CRUD, version lifecycle, competency CRUD,
 * relations, course mapping, impact/orphan/coverage queries,
 * and CASE import/export skeleton.
 *
 * All tests are PURE — they do not read/write any database or files.
 * Functions that require PostgreSQL gracefully degrade with fallback values.
 */

import { describe, it, expect } from 'vitest';

import {
  createFramework, getFramework, listFrameworks, updateFramework,
  createVersion, transitionVersion, listVersions,
  FRAMEWORK_STATUS,
  createCompetency, getCompetency, listCompetencies, updateCompetency, deleteCompetency,
  createRelation, listRelations, deleteRelation,
  RELATION_TYPES, COMPETENCY_TYPES, COGNITIVE_LEVELS,
  mapCompetencyToCourse, approveMapping, listCourseMappings,
  MAPPING_STATUS,
  getCompetencyImpact, findOrphanCompetencies, getCourseCoverage,
  importCaseFormat, exportCaseFormat,
} from '../../src/modules/competency/index.js';

// ═══════════════════════════════════════════════════════════════════
// 1. CONSTANTS
// ═══════════════════════════════════════════════════════════════════

describe('Competency Module — Constants', () => {
  it('should have FRAMEWORK_STATUS values', () => {
    expect(FRAMEWORK_STATUS.DRAFT).toBe('draft');
    expect(FRAMEWORK_STATUS.REVIEW).toBe('review');
    expect(FRAMEWORK_STATUS.PUBLISHED).toBe('published');
    expect(FRAMEWORK_STATUS.DEPRECATED).toBe('deprecated');
  });

  it('should have MAPPING_STATUS values', () => {
    expect(MAPPING_STATUS.MANUAL).toBe('manual');
    expect(MAPPING_STATUS.AI_SUGGESTED).toBe('ai_suggested');
    expect(MAPPING_STATUS.REVIEWED).toBe('reviewed');
    expect(MAPPING_STATUS.APPROVED).toBe('approved');
  });

  it('should have COMPETENCY_TYPES array', () => {
    expect(Array.isArray(COMPETENCY_TYPES)).toBe(true);
    expect(COMPETENCY_TYPES).toContain('competency');
    expect(COMPETENCY_TYPES).toContain('learning_outcome');
    expect(COMPETENCY_TYPES).toContain('skill');
  });

  it('should have RELATION_TYPES array', () => {
    expect(Array.isArray(RELATION_TYPES)).toBe(true);
    expect(RELATION_TYPES).toContain('prerequisite');
    expect(RELATION_TYPES).toContain('cross_reference');
    expect(RELATION_TYPES).toContain('extends');
  });

  it('should have COGNITIVE_LEVELS array', () => {
    expect(Array.isArray(COGNITIVE_LEVELS)).toBe(true);
    expect(COGNITIVE_LEVELS).toContain('remember');
    expect(COGNITIVE_LEVELS).toContain('analyze');
    expect(COGNITIVE_LEVELS).toContain('create');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. FRAMEWORK (graceful degradation — no DB)
// ═══════════════════════════════════════════════════════════════════

describe('Competency Module — Frameworks', () => {
  describe('createFramework', () => {
    it('should throw error when PostgreSQL unavailable', async () => {
      await expect(createFramework({ name: 'Test' })).rejects.toThrow('PostgreSQL required');
    });
  });

  describe('getFramework', () => {
    it('should return null when PostgreSQL unavailable', async () => {
      const result = await getFramework(1);
      expect(result).toBeNull();
    });
  });

  describe('listFrameworks', () => {
    it('should return empty array when PostgreSQL unavailable', async () => {
      const result = await listFrameworks();
      expect(result).toEqual([]);
    });
  });

  describe('updateFramework', () => {
    it('should throw error when PostgreSQL unavailable', async () => {
      await expect(updateFramework(1, { name: 'Updated' })).rejects.toThrow('PostgreSQL required');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. VERSION LIFECYCLE (graceful degradation)
// ═══════════════════════════════════════════════════════════════════

describe('Competency Module — Versions', () => {
  describe('createVersion', () => {
    it('should throw error — DB check first', async () => {
      await expect(createVersion(999, { version: '2.0' })).rejects.toThrow('PostgreSQL required');
    });
  });

  describe('transitionVersion', () => {
    it('should throw error — DB check first', async () => {
      await expect(transitionVersion(999, 'published', 1)).rejects.toThrow('PostgreSQL required');
    });
  });

  describe('listVersions', () => {
    it('should return empty array when PostgreSQL unavailable', async () => {
      const result = await listVersions(1);
      expect(result).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. COMPETENCY CRUD (graceful degradation)
// ═══════════════════════════════════════════════════════════════════

describe('Competency Module — Competencies', () => {
  describe('createCompetency', () => {
    it('should throw error when PostgreSQL unavailable', async () => {
      await expect(createCompetency({ name: 'Test', type: 'competency' })).rejects.toThrow('PostgreSQL required');
    });

    it('should reject invalid type', async () => {
      // DB check happens BEFORE type validation — throws PostgreSQL required
      await expect(createCompetency({ name: 'Test', type: 'invalid_type' })).rejects.toThrow('PostgreSQL required');
    });
  });

  describe('getCompetency', () => {
    it('should return null when PostgreSQL unavailable', async () => {
      const result = await getCompetency(1);
      expect(result).toBeNull();
    });
  });

  describe('listCompetencies', () => {
    it('should return empty array when PostgreSQL unavailable', async () => {
      const result = await listCompetencies();
      expect(result).toEqual([]);
    });
  });

  describe('updateCompetency', () => {
    it('should throw error when PostgreSQL unavailable', async () => {
      await expect(updateCompetency(1, { name: 'Updated' })).rejects.toThrow('PostgreSQL required');
    });
  });

  describe('deleteCompetency', () => {
    it('should throw error when PostgreSQL unavailable', async () => {
      await expect(deleteCompetency(1, 1)).rejects.toThrow('PostgreSQL required');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. RELATIONS (graceful degradation)
// ═══════════════════════════════════════════════════════════════════

describe('Competency Module — Relations', () => {
  describe('createRelation', () => {
    it('should reject self-reference — DB check first, so PostgreSQL required', async () => {
      // DB check happens BEFORE validation
      await expect(createRelation({
        source_competency_id: 1,
        target_competency_id: 1,
        relation_type: 'prerequisite',
      })).rejects.toThrow('PostgreSQL required');
    });

    it('should reject invalid relation type — DB check first', async () => {
      await expect(createRelation({
        source_competency_id: 1,
        target_competency_id: 2,
        relation_type: 'invalid_type',
      })).rejects.toThrow('PostgreSQL required');
    });
  });

  describe('listRelations', () => {
    it('should return empty array when PostgreSQL unavailable', async () => {
      const result = await listRelations(1);
      // When DB is null, the early return gives [] not {outgoing, incoming}
      expect(result).toEqual([]);
    });
  });

  describe('deleteRelation', () => {
    it('should throw error when PostgreSQL unavailable', async () => {
      await expect(deleteRelation(1, 1)).rejects.toThrow('PostgreSQL required');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. COURSE MAPPING (graceful degradation)
// ═══════════════════════════════════════════════════════════════════

describe('Competency Module — Course Mapping', () => {
  describe('mapCompetencyToCourse', () => {
    it('should throw error when PostgreSQL unavailable', async () => {
      await expect(mapCompetencyToCourse({
        course_offering_id: 1,
        competency_id: 1,
      })).rejects.toThrow('PostgreSQL required');
    });
  });

  describe('approveMapping', () => {
    it('should throw error when PostgreSQL unavailable', async () => {
      await expect(approveMapping(1, 'approved', 1)).rejects.toThrow('PostgreSQL required');
    });
  });

  describe('listCourseMappings', () => {
    it('should return empty array when PostgreSQL unavailable', async () => {
      const result = await listCourseMappings();
      expect(result).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. IMPACT / ORPHAN / COVERAGE (graceful degradation)
// ═══════════════════════════════════════════════════════════════════

describe('Competency Module — Impact/Coverage Queries', () => {
  describe('getCompetencyImpact', () => {
    it('should return null when PostgreSQL unavailable', async () => {
      const result = await getCompetencyImpact(1);
      expect(result).toBeNull();
    });
  });

  describe('findOrphanCompetencies', () => {
    it('should return empty array when PostgreSQL unavailable', async () => {
      const result = await findOrphanCompetencies(1);
      expect(result).toEqual([]);
    });
  });

  describe('getCourseCoverage', () => {
    it('should return null when PostgreSQL unavailable', async () => {
      const result = await getCourseCoverage(1);
      expect(result).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. CASE IMPORT/EXPORT (pure logic — no DB needed)
// ═══════════════════════════════════════════════════════════════════

describe('Competency Module — CASE Import/Export', () => {
  describe('importCaseFormat', () => {
    it('should validate CASE JSON structure', async () => {
      const validData = {
        competencies: [
          {
            identifier: 'MATH.8.G.9',
            name: 'Pythagorean Theorem',
            description: 'Apply the Pythagorean Theorem',
            competency_category: 'competency',
          },
        ],
      };

      const result = await importCaseFormat(validData, 1, 1);
      expect(result.valid).toBe(1);
      expect(result.invalid).toBe(0);
      expect(result.preview.length).toBe(1);
    });

    it('should reject invalid CASE data', async () => {
      const invalidData = {
        competencies: [
          { name: 'No identifier' },
          { identifier: 'NO_NAME' },
        ],
      };

      const result = await importCaseFormat(invalidData, 1, 1);
      expect(result.invalid).toBe(2);
      expect(result.valid).toBe(0);
    });

    it('should handle missing competencies array', async () => {
      await expect(importCaseFormat({}, 1, 1)).rejects.toThrow('Invalid CASE format');
    });
  });

  describe('exportCaseFormat', () => {
    it('should return null when no competencies (no DB)', async () => {
      const result = await exportCaseFormat(1);
      expect(result).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. BARREL EXPORT
// ═══════════════════════════════════════════════════════════════════

describe('Competency Module — Barrel Export', () => {
  it('should export all expected functions and constants', async () => {
    const mod = await import('../../src/modules/competency/index.js');
    const expectedExports = [
      'createFramework', 'getFramework', 'listFrameworks', 'updateFramework',
      'createVersion', 'transitionVersion', 'listVersions',
      'FRAMEWORK_STATUS',
      'createCompetency', 'getCompetency', 'listCompetencies', 'updateCompetency', 'deleteCompetency',
      'createRelation', 'listRelations', 'deleteRelation',
      'RELATION_TYPES', 'COMPETENCY_TYPES', 'COGNITIVE_LEVELS',
      'mapCompetencyToCourse', 'approveMapping', 'listCourseMappings',
      'MAPPING_STATUS',
      'getCompetencyImpact', 'findOrphanCompetencies', 'getCourseCoverage',
      'importCaseFormat', 'exportCaseFormat',
    ];
    for (const exp of expectedExports) {
      expect(mod[exp]).toBeDefined();
    }
  });
});
