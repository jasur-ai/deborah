/**
 * Edikit — Competency & Curriculum Graph Module Barrel Export
 *
 * Provides versioned competency/outcome framework management:
 *   - Framework CRUD (create/get/list/update)
 *   - Version lifecycle (DRAFT→REVIEW→PUBLISHED→DEPRECATED)
 *   - Competency CRUD with hierarchy (parent/child)
 *   - Competency relations (prerequisite, cross-reference, etc.)
 *   - Course→Competency mapping (with AI_SUGGESTED status)
 *   - Impact/orphan/coverage queries
 *   - CASE import/export skeleton
 *
 * Usage:
 *   import * as competency from '../modules/competency/index.js';
 *   // Or:
 *   import { createFramework } from '../modules/competency/index.js';
 */

export {
  // Framework
  createFramework,
  getFramework,
  listFrameworks,
  updateFramework,

  // Version lifecycle
  createVersion,
  transitionVersion,
  listVersions,
  FRAMEWORK_STATUS,

  // Competency CRUD
  createCompetency,
  getCompetency,
  listCompetencies,
  updateCompetency,
  deleteCompetency,

  // Relations
  createRelation,
  listRelations,
  deleteRelation,
  RELATION_TYPES,

  // Course mapping
  mapCompetencyToCourse,
  approveMapping,
  listCourseMappings,
  MAPPING_STATUS,

  // Impact/Coverage queries
  getCompetencyImpact,
  findOrphanCompetencies,
  getCourseCoverage,

  // CASE adapter
  importCaseFormat,
  exportCaseFormat,

  // Constants
  COMPETENCY_TYPES,
  COGNITIVE_LEVELS,
} from './competency.service.js';
