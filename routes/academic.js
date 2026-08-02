/**
 * Edikit — Academic API Routes
 *
 * Provides CRUD endpoints for the academic hierarchy:
 *   GET/POST  /api/academic/terms
 *   GET/PUT   /api/academic/terms/:id
 *   DELETE    /api/academic/terms/:id (archive)
 *
 *   GET/POST  /api/academic/faculties
 *   GET/PUT   /api/academic/faculties/:id
 *
 *   GET/POST  /api/academic/programs
 *   GET/PUT   /api/academic/programs/:id
 *
 *   GET/POST  /api/academic/courses (course offerings)
 *   GET/PUT   /api/academic/courses/:id
 *
 *   GET       /api/academic/courses/teacher-list (teacher's courses)
 *
 *   GET/POST  /api/academic/groups
 *   GET/PUT   /api/academic/groups/:id
 *   DELETE    /api/academic/groups/:id
 *
 *   GET/POST  /api/academic/enrollments
 *   PUT       /api/academic/enrollments/:id
 *   POST      /api/academic/enrollments/bulk
 *
 * All endpoints require authentication.
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  getTerms, getTermById, createTerm, updateTerm, archiveTerm,
  getFaculties, getFacultyById, createFaculty, updateFaculty, archiveFaculty,
  getPrograms, getProgramById, createProgram, updateProgram, archiveProgram,
  getCourseOfferings, getCourseOfferingById, createCourseOffering,
  updateCourseOffering, archiveCourseOffering, getTeacherCourseList,
  getGroups, getGroupById, createGroup, updateGroup, deleteGroup,
  getGroupMembers, addGroupMember, removeGroupMember,
  getEnrollments, enrollStudent, updateEnrollment, bulkEnroll,
} from '../src/modules/academic/index.js';
import { getTeacherOfferings } from '../src/modules/academic/teachers.js';

const router = Router();

// ── All academic endpoints require auth. Scoped to THIS router's own
//    /api/academic/* namespace (NOT the bare /api prefix) — a bare
//    router.use('/api', requireAuth) would also intercept /api/admin/*
//    routes from other routers and 401 them even with a valid admin
//    session (requireAuth only accepts student sessions). ──
router.use('/api/academic', requireAuth);

// ═══════════════════════════════════════════════════════════════
// ACADEMIC TERMS
// ═══════════════════════════════════════════════════════════════

router.get('/api/academic/terms', async (req, res) => {
  try {
    const terms = await getTerms({ tenantId: req.session?.user?.tenant_id });
    res.json(terms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/academic/terms/:id', async (req, res) => {
  try {
    const term = await getTermById(parseInt(req.params.id), req.session?.user?.tenant_id);
    if (!term) return res.status(404).json({ error: 'Term not found' });
    res.json(term);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/academic/terms', async (req, res) => {
  try {
    const result = await createTerm(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/academic/terms/:id', async (req, res) => {
  try {
    await updateTerm(parseInt(req.params.id), req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/academic/terms/:id', async (req, res) => {
  try {
    await archiveTerm(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// FACULTIES
// ═══════════════════════════════════════════════════════════════

router.get('/api/academic/faculties', async (req, res) => {
  try {
    const faculties = await getFaculties({ tenantId: req.session?.user?.tenant_id });
    res.json(faculties);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/academic/faculties/:id', async (req, res) => {
  try {
    const faculty = await getFacultyById(parseInt(req.params.id), req.session?.user?.tenant_id);
    if (!faculty) return res.status(404).json({ error: 'Faculty not found' });
    res.json(faculty);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/academic/faculties', async (req, res) => {
  try {
    const result = await createFaculty(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/academic/faculties/:id', async (req, res) => {
  try {
    await updateFaculty(parseInt(req.params.id), req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/academic/faculties/:id', async (req, res) => {
  try {
    await archiveFaculty(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// PROGRAMS
// ═══════════════════════════════════════════════════════════════

router.get('/api/academic/programs', async (req, res) => {
  try {
    const programs = await getPrograms({
      tenantId: req.session?.user?.tenant_id,
      facultyId: req.query.facultyId ? parseInt(req.query.facultyId) : undefined,
    });
    res.json(programs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/academic/programs/:id', async (req, res) => {
  try {
    const program = await getProgramById(parseInt(req.params.id), req.session?.user?.tenant_id);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    res.json(program);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/academic/programs', async (req, res) => {
  try {
    const result = await createProgram(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/academic/programs/:id', async (req, res) => {
  try {
    await updateProgram(parseInt(req.params.id), req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/academic/programs/:id', async (req, res) => {
  try {
    await archiveProgram(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// COURSE OFFERINGS
// ═══════════════════════════════════════════════════════════════

router.get('/api/academic/courses', async (req, res) => {
  try {
    const courses = await getCourseOfferings({
      tenantId: req.session?.user?.tenant_id,
      termId: req.query.termId ? parseInt(req.query.termId) : undefined,
      status: req.query.status,
    });
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Teacher course list — returns courses where the current user is a teacher.
 */
router.get('/api/academic/courses/teacher-list', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const courses = await getTeacherOfferings(userId);
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/academic/courses/:id', async (req, res) => {
  try {
    const course = await getCourseOfferingById(parseInt(req.params.id), req.session?.user?.tenant_id);
    if (!course) return res.status(404).json({ error: 'Course offering not found' });
    res.json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/academic/courses', async (req, res) => {
  try {
    const result = await createCourseOffering(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/academic/courses/:id', async (req, res) => {
  try {
    await updateCourseOffering(parseInt(req.params.id), req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/academic/courses/:id', async (req, res) => {
  try {
    await archiveCourseOffering(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GROUPS
// ═══════════════════════════════════════════════════════════════

router.get('/api/academic/groups', async (req, res) => {
  try {
    const groups = await getGroups({
      courseOfferingId: req.query.courseOfferingId ? parseInt(req.query.courseOfferingId) : undefined,
      type: req.query.type,
    });
    // Include member count per group
    const groupsWithCounts = await Promise.all(groups.map(async (g) => {
      const members = await getGroupMembers(g.id);
      return { ...g, memberCount: members.length };
    }));
    res.json(groupsWithCounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/academic/groups/:id', async (req, res) => {
  try {
    const group = await getGroupById(parseInt(req.params.id));
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const members = await getGroupMembers(group.id);
    res.json({ ...group, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/academic/groups', async (req, res) => {
  try {
    const result = await createGroup(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/academic/groups/:id', async (req, res) => {
  try {
    await updateGroup(parseInt(req.params.id), req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/academic/groups/:id', async (req, res) => {
  try {
    await deleteGroup(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Group Members ──
router.post('/api/academic/groups/:groupId/members', async (req, res) => {
  try {
    await addGroupMember(parseInt(req.params.groupId), req.body.userId, req.body.role);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/academic/groups/:groupId/members/:userId', async (req, res) => {
  try {
    await removeGroupMember(parseInt(req.params.groupId), parseInt(req.params.userId));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ENROLLMENTS
// ═══════════════════════════════════════════════════════════════

router.get('/api/academic/enrollments', async (req, res) => {
  try {
    const enrollments = await getEnrollments({
      tenantId: req.session?.user?.tenant_id,
      courseOfferingId: req.query.courseOfferingId ? parseInt(req.query.courseOfferingId) : undefined,
      status: req.query.status,
      userId: req.query.userId ? parseInt(req.query.userId) : undefined,
    });
    res.json(enrollments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/academic/enrollments', async (req, res) => {
  try {
    const result = await enrollStudent(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/academic/enrollments/:id', async (req, res) => {
  try {
    await updateEnrollment(parseInt(req.params.id), req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/academic/enrollments/bulk', async (req, res) => {
  try {
    const result = await bulkEnroll(req.body.enrollments || []);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
