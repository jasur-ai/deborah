/**
 * Edikit — Shared Result / Error Contracts
 *
 * Provides the canonical Result type used across all typed modules.
 * Inspired by Rust's Result<T, E> pattern.
 *
 * Usage:
 *   const result: Result<User> = await findUser(id);
 *   if (result.ok) { result.data.name; }
 *   else { result.error.message; }
 *
 * This is the foundation for all typed module boundaries.
 */

// ── Error types ──

export interface AppError {
  readonly code: string;
  readonly message: string;
  readonly status?: number;
  readonly details?: Record<string, unknown>;
  readonly cause?: Error;
}

export function createError(
  code: string,
  message: string,
  opts?: { status?: number; details?: Record<string, unknown>; cause?: Error }
): AppError {
  return {
    code,
    message,
    status: opts?.status ?? 500,
    details: opts?.details,
    cause: opts?.cause,
  };
}

// Common error codes
export const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION: 'VALIDATION',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
  RATE_LIMIT: 'RATE_LIMIT',
  CSRF_FAILED: 'CSRF_FAILED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
} as const;

// ── Result type ──

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

// ── Result constructors ──

export function success<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function failure<T = never>(error: AppError): Result<T> {
  return { ok: false, error };
}

// ── HTTP error mapping ──

export function toHttpStatus(error: AppError): number {
  return error.status ?? 500;
}

export function toHttpResponse(error: AppError): Record<string, unknown> {
  return {
    error: error.message,
    code: error.code,
    status: toHttpStatus(error),
    ...(error.details ? { details: error.details } : {}),
  };
}

// ── Pagination types ──

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function createPaginatedResult<T>(
  items: T[],
  total: number,
  params: PaginationParams
): PaginatedResult<T> {
  return {
    items,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(total / params.limit) || 1,
  };
}
