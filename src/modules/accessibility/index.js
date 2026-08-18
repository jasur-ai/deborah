/**
 * Deborah — WCAG 2.2 AA & Artifact Accessibility Barrel Export
 *
 * Prompt 64 — accessibility settings, ACR audits, known-gap backlog va
 * PDF/DOCX/PPTX artifact QA. Automated checker yetarli emas — inson
 * verification (ACR sign-off) talab qilinadi (§15).
 *
 * Usage:
 *   import * as a11y from '../modules/accessibility/index.js';
 */

export {
  getAccessibilitySettings,
  saveAccessibilitySettings,
  runAudit,
  listAudits,
  createGap,
  transitionGapStatus,
  listGaps,
  checkArtifact,
  listArtifactChecks,
  getAccessibilitySummary,
} from './accessibility.service.js';
