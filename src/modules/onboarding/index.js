/**
 * AUTH B-17 — Onboarding moduli (state machine + Orient + demo bank).
 */
export {
  ONBOARDING_STEPS,
  SKIP_ACTIVATION_BONUS,
  FIRST_WIN_ITEMS,
  stepIndex,
  canAdvance,
  normalizeState,
  getOnboardingState,
  getOrCreateOnboarding,
  submitOrient,
  skipOrient,
  onboardingProgress,
  startFirstWin,
  submitFirstWinAnswer,
  completeFirstWin,
  CHECKLIST_ITEMS,
  checklistItemState,
  checklistProgress,
  submitChecklistItem,
  getChecklistView,
} from './service.js';
export {
  DEMO_SUBJECTS,
  DEMO_SUBJECT_LABELS,
  FIRST_WIN_COUNT,
  getDemoQuestion,
  checkDemoAnswer,
  getFirstWinSet,
  checkFirstWinAnswer,
  demoBankCoverage,
  demoBankCoverageCount,
} from './demo-bank.js';
