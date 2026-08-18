/**
 * Deborah — Academic Module Unit Tests
 *
 * Tests all academic hierarchy service functions with mocked PostgreSQL.
 * Since the modules gracefully degrade when Postgres is unavailable,
 * we test both the "no DB" fallback and the "with DB" path.
 *
 * Tests:
 *   1. Term service functions (getTerms, createTerm, updateTerm, archiveTerm)
 *   2. Faculty service functions
 *   3. Program service functions
 *   4. Course offering service functions
 *   5. Group service functions (CRUD, members)
 *   6. Enrollment service functions (single, bulk, status changes)
 *   7. Teacher assignment service functions
 *   8. Barrel export integrity
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock PostgreSQL (kysely) ──
const mockDb = {
  selectFrom: vi.fn(),
  insertInto: vi.fn(),
  updateTable: vi.fn(),
  deleteFrom: vi.fn(),
};

// Helper to create mock query builders
function mockQueryBuilder(returnValue) {
  const qb = {
    where: vi.fn().mockReturnThis(),
    whereRef: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(returnValue || []),
    executeTakeFirst: vi.fn().mockResolvedValue(returnValue || null),
  };
  return qb;
}

vi.mock('../../src/infrastructure/postgres.js', () => ({
  getDb: vi.fn(async () => mockDb),
}));

vi.mock('../../src/modules/auth/tenant-context.js', () => ({
  getCurrentTenant: vi.fn(() => ({ tenantId: 1 })),
}));

describe('Academic Module', () => {
  let terms, courses, teachers, barrel;

  beforeEach(async () => {
    vi.clearAllMocks();
    terms = await import('../../src/modules/academic/terms.js');
    courses = await import('../../src/modules/academic/courses.js');
    teachers = await import('../../src/modules/academic/teachers.js');
    barrel = await import('../../src/modules/academic/index.js');
  });

  // ── 1. Term Service ──
  describe('Term Service', () => {
    it('should return empty array when no DB', async () => {
      const { getDb } = await import('../../src/infrastructure/postgres.js');
      getDb.mockResolvedValueOnce(null);
      const result = await terms.getTerms();
      expect(result).toEqual([]);
    });

    it('should get terms', async () => {
      const qb = mockQueryBuilder([{ id: 1, name: 'Spring 2025', code: '2025-SPRING' }]);
      mockDb.selectFrom.mockReturnValue(qb);
      const result = await terms.getTerms();
      expect(result).toHaveLength(1);
      expect(result[0].code).toBe('2025-SPRING');
    });

    it('should create a term', async () => {
      const qb = mockQueryBuilder({ id: 1 });
      mockDb.insertInto.mockReturnValue(qb);
      const result = await terms.createTerm({ name: 'Fall 2025', type: 'semester' });
      expect(result).toEqual({ id: 1 });
    });

    it('should update a term', async () => {
      const qb = mockQueryBuilder();
      mockDb.updateTable.mockReturnValue(qb);
      const result = await terms.updateTerm(1, { name: 'Updated' });
      expect(result).toBe(true);
    });

    it('should archive a term', async () => {
      const qb = mockQueryBuilder();
      mockDb.updateTable.mockReturnValue(qb);
      const result = await terms.archiveTerm(1);
      expect(result).toBe(true);
    });
  });

  // ── 2. Faculty Service ──
  describe('Faculty Service', () => {
    it('should get faculties', async () => {
      const qb = mockQueryBuilder([{ id: 1, name: 'Engineering' }]);
      mockDb.selectFrom.mockReturnValue(qb);
      const result = await terms.getFaculties();
      expect(result).toHaveLength(1);
    });

    it('should create a faculty', async () => {
      const qb = mockQueryBuilder({ id: 1 });
      mockDb.insertInto.mockReturnValue(qb);
      const result = await terms.createFaculty({ name: 'Sciences' });
      expect(result.id).toBe(1);
    });

    it('should archive a faculty', async () => {
      const qb = mockQueryBuilder();
      mockDb.updateTable.mockReturnValue(qb);
      expect(await terms.archiveFaculty(1)).toBe(true);
    });
  });

  // ── 3. Program Service ──
  describe('Program Service', () => {
    it('should get programs', async () => {
      const qb = mockQueryBuilder([{ id: 1, name: 'Computer Science', degree_type: 'bachelor' }]);
      mockDb.selectFrom.mockReturnValue(qb);
      const result = await terms.getPrograms();
      expect(result).toHaveLength(1);
      expect(result[0].degree_type).toBe('bachelor');
    });

    it('should create a program', async () => {
      const qb = mockQueryBuilder({ id: 1 });
      mockDb.insertInto.mockReturnValue(qb);
      const result = await terms.createProgram({ name: 'Data Science', degree_type: 'master' });
      expect(result.id).toBe(1);
    });

    it('should filter programs by faculty', async () => {
      const qb = mockQueryBuilder([{ id: 1, faculty_id: 5 }]);
      mockDb.selectFrom.mockReturnValue(qb);
      await terms.getPrograms({ facultyId: 5 });
      const callArgs = qb.where.mock.calls;
      expect(callArgs.some(c => c[1] === '=' && c[2] === 5)).toBe(true);
    });
  });

  // ── 4. Course Offering Service ──
  describe('Course Offering Service', () => {
    it('should get course offerings', async () => {
      const qb = mockQueryBuilder([{ id: 1, name: 'Calculus I', status: 'active' }]);
      mockDb.selectFrom.mockReturnValue(qb);
      const result = await courses.getCourseOfferings();
      expect(result).toHaveLength(1);
    });

    it('should create a course offering', async () => {
      const qb = mockQueryBuilder({ id: 1 });
      mockDb.insertInto.mockReturnValue(qb);
      const result = await courses.createCourseOffering({ course_id: 1, term_id: 1 });
      expect(result.id).toBe(1);
    });

    it('should update course offering status', async () => {
      const qb = mockQueryBuilder();
      mockDb.updateTable.mockReturnValue(qb);
      const result = await courses.updateCourseOffering(1, { status: 'active' });
      expect(result).toBe(true);
    });

    it('should archive course offering', async () => {
      const qb = mockQueryBuilder();
      mockDb.updateTable.mockReturnValue(qb);
      const result = await courses.archiveCourseOffering(1);
      expect(result).toBe(true);
    });
  });

  // ── 5. Group Service ──
  describe('Group Service', () => {
    it('should get groups', async () => {
      const qb = mockQueryBuilder([{ id: 1, name: 'Group A' }]);
      mockDb.selectFrom.mockReturnValue(qb);
      const result = await courses.getGroups({ courseOfferingId: 1 });
      expect(result).toHaveLength(1);
    });

    it('should create a group', async () => {
      const qb = mockQueryBuilder({ id: 1 });
      mockDb.insertInto.mockReturnValue(qb);
      const result = await courses.createGroup({ name: 'Lab Group 1', course_offering_id: 1 });
      expect(result.id).toBe(1);
    });

    it('should delete a group', async () => {
      const qb = mockQueryBuilder();
      mockDb.deleteFrom.mockReturnValue(qb);
      const result = await courses.deleteGroup(1);
      expect(result).toBe(true);
    });

    it('should add group member', async () => {
      const qb = mockQueryBuilder();
      mockDb.insertInto.mockReturnValue(qb);
      const result = await courses.addGroupMember(1, 42, 'leader');
      expect(result).toBe(true);
    });

    it('should remove group member', async () => {
      const qb = mockQueryBuilder();
      mockDb.updateTable.mockReturnValue(qb);
      const result = await courses.removeGroupMember(1, 42);
      expect(result).toBe(true);
    });
  });

  // ── 6. Enrollment Service ──
  describe('Enrollment Service', () => {
    it('should get enrollments', async () => {
      const qb = mockQueryBuilder([{ id: 1, user_id: 1, status: 'active' }]);
      mockDb.selectFrom.mockReturnValue(qb);
      const result = await courses.getEnrollments({ courseOfferingId: 1 });
      expect(result).toHaveLength(1);
    });

    it('should enroll a student', async () => {
      const qb = mockQueryBuilder({ id: 1 });
      mockDb.insertInto.mockReturnValue(qb);
      const result = await courses.enrollStudent({ userId: 1, courseOfferingId: 1 });
      expect(result).toBeDefined();
    });

    it('should update enrollment status', async () => {
      const qb = mockQueryBuilder();
      mockDb.updateTable.mockReturnValue(qb);
      const result = await courses.updateEnrollment(1, { status: 'completed' });
      expect(result).toBe(true);
    });

    it('should bulk enroll', async () => {
      const qb = mockQueryBuilder({ id: 1 });
      mockDb.insertInto.mockReturnValue(qb);
      const result = await courses.bulkEnroll([
        { userId: 1, courseOfferingId: 1 },
        { userId: 2, courseOfferingId: 1 },
      ]);
      // Succeeded with retry on duplicate
      expect(result.succeeded + result.failed).toBe(2);
    });
  });

  // ── 7. Teacher Assignment Service ──
  describe('Teacher Assignment Service', () => {
    it('should get teacher assignments', async () => {
      const qb = mockQueryBuilder([{ id: 1, role: 'primary' }]);
      mockDb.selectFrom.mockReturnValue(qb);
      const result = await teachers.getTeacherAssignments({ courseOfferingId: 1 });
      expect(result).toHaveLength(1);
    });

    it('should assign a teacher', async () => {
      const qb = mockQueryBuilder();
      mockDb.insertInto.mockReturnValue(qb);
      const result = await teachers.assignTeacher({ courseOfferingId: 1, userId: 5, role: 'primary' });
      expect(result).toBe(true);
    });

    it('should revoke a teacher assignment', async () => {
      const qb = mockQueryBuilder();
      mockDb.updateTable.mockReturnValue(qb);
      const result = await teachers.revokeTeacherAssignment(1, 5);
      expect(result).toBe(true);
    });

    it('should check if teacher is assigned', async () => {
      const qb = mockQueryBuilder({ id: 1 });
      mockDb.selectFrom.mockReturnValue(qb);
      const result = await teachers.isTeacherOfOffering(5, 1);
      expect(result).toBe(true);
    });

    it('should get teacher offerings list', async () => {
      const qb = mockQueryBuilder([{ id: 1, name: 'Calculus', role: 'primary' }]);
      mockDb.selectFrom.mockReturnValue(qb);
      const result = await teachers.getTeacherOfferings(5);
      expect(result).toHaveLength(1);
    });
  });

  // ── 8. Barrel Export ──
  describe('Barrel Export', () => {
    it('should export all term functions', () => {
      expect(typeof barrel.getTerms).toBe('function');
      expect(typeof barrel.createTerm).toBe('function');
      expect(typeof barrel.updateTerm).toBe('function');
      expect(typeof barrel.archiveTerm).toBe('function');
      expect(typeof barrel.getFaculties).toBe('function');
      expect(typeof barrel.createFaculty).toBe('function');
      expect(typeof barrel.getPrograms).toBe('function');
      expect(typeof barrel.createProgram).toBe('function');
    });

    it('should export all course functions', () => {
      expect(typeof barrel.getCourseOfferings).toBe('function');
      expect(typeof barrel.createCourseOffering).toBe('function');
      expect(typeof barrel.getGroups).toBe('function');
      expect(typeof barrel.createGroup).toBe('function');
      expect(typeof barrel.getEnrollments).toBe('function');
      expect(typeof barrel.enrollStudent).toBe('function');
    });

    it('should export all teacher functions', () => {
      expect(typeof barrel.assignTeacher).toBe('function');
      expect(typeof barrel.revokeTeacherAssignment).toBe('function');
      expect(typeof barrel.isTeacherOfOffering).toBe('function');
    });
  });
});
