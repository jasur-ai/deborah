/**
 * Edikit — Rubric Builder Module Barrel Export
 *
 * Provides analytic rubrics for written work grading:
 *   - Versioned rubrics (DRAFT→PUBLISHED→DEPRECATED lifecycle)
 *   - Scoring criteria with levels, concepts, contradictions
 *   - Anchor responses for calibration
 *   - Item↔Rubric pin for exact version control
 *
 * Usage:
 *   import * as rubric from '../modules/rubric/index.js';
 *   // Or:
 *   import { createRubric, createCriterion } from '../modules/rubric/index.js';
 */

export {
  createRubric, getRubric, listRubrics, updateRubric,
  createRubricVersion, transitionRubricVersion, listRubricVersions, diffRubricVersions,
  createCriterion, updateCriterion, deleteCriterion, listCriteria,
  getRubricVersionMaxPoints,
  createAnchor, listAnchors, deleteAnchor,
  pinRubricToItem, getPinnedRubric, unpinRubricFromItem,
  generateRubricPreview,
  RUBRIC_TYPES, RUBRIC_STATUS, ANCHOR_TYPES, EVIDENCE_TYPES,
} from './rubric.service.js';
