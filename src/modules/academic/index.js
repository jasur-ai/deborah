/**
 * Deborah — Academic Module Barrel Export
 *
 * Exports all academic hierarchy services:
 *   - terms: academic term, faculty, program management
 *   - courses: course offering, group, enrollment management
 *   - teachers: teacher assignment management
 *
 * All services gracefully degrade when PostgreSQL is not configured,
 * using the Firebase/local-db fallback where possible.
 */

export {
  getTerms, getTermById, createTerm, updateTerm, archiveTerm,
  getFaculties, getFacultyById, createFaculty, updateFaculty, archiveFaculty,
  getPrograms, getProgramById, createProgram, updateProgram, archiveProgram,
} from './terms.js';

export {
  getCourseOfferings, getCourseOfferingById, createCourseOffering,
  updateCourseOffering, archiveCourseOffering, getTeacherCourseList,
  getGroups, getGroupById, createGroup, updateGroup, deleteGroup,
  getGroupMembers, addGroupMember, removeGroupMember,
  getEnrollments, enrollStudent, updateEnrollment, bulkEnroll,
} from './courses.js';

export {
  getTeacherAssignments, assignTeacher, revokeTeacherAssignment,
  getTeachersForOffering, isTeacherOfOffering,
} from './teachers.js';
