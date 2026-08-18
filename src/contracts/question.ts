/**
 * Deborah — Question Public/Private DTO Contracts
 *
 * Separates public question data (sent to clients) from private
 * scoring key (kept server-side only).
 *
 * ── Rules ──
 * - NEVER emit `correct` or `qCorrect` to clients in preview/active events
 * - Scoring key is read from the server-stored session data
 * - Only emit `correct` answer AFTER answer collection is closed (reveal event)
 */

// ── Public Question (safe for client emission) ──

export interface PublicQuestion {
  text: string;
  options: string[];
  isDouble: boolean;
}

export interface QuestionPreviewEvent {
  qIndex: number;
  totalQuestions: number;
  qText: string;
  qIsDouble: boolean;
  countdown: number;
}

export interface QuestionActiveEvent {
  qIndex: number;
  qText: string;
  qOptions: string[];
  qIsDouble: boolean;
  qTime: number;
  startedAt: number;
}

// ── Answer Reveal (emitted after scoring, includes correct answer) ──

export interface AnswerRevealEvent {
  qIndex: number;
  correctOptionIndex: number;
  correctText: string;
  stats: {
    total: number;
    answered: number;
    correct: number;
    incorrect: number;
  };
}

// ── Private Scoring Key (server-side only, NEVER emit) ──

export interface PrivateQuestionData {
  text: string;
  options: string[];
  correct: number;        // ← THIS IS THE SECRET
  isDouble: boolean;
}

export interface PrivateSessionQuestions {
  questions: PrivateQuestionData[];
}

// ── Helper: Strip private fields ──

export function toPublicQuestion(q: PrivateQuestionData): PublicQuestion {
  return {
    text: q.text,
    options: q.options,
    isDouble: !!q.isDouble,
  };
}

export function toPublicPreviewEvent(q: PrivateQuestionData, qIndex: number, totalQuestions: number, countdown: number): QuestionPreviewEvent {
  return {
    qIndex,
    totalQuestions,
    qText: q.text,
    qIsDouble: !!q.isDouble,
    countdown,
  };
}

export function toPublicActiveEvent(q: PrivateQuestionData, qIndex: number, qTime: number, startedAt: number): QuestionActiveEvent {
  return {
    qIndex,
    qText: q.text,
    qOptions: q.options,
    qIsDouble: !!q.isDouble,
    qTime,
    startedAt,
  };
}
