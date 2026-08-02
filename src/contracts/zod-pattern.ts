/**
 * Edikit — Zod Contract Export Pattern
 *
 * This file documents the standard pattern for creating TypeScript-safe
 * contracts using Zod. All new feature modules should follow this pattern.
 *
 * ── Pattern ──
 *
 * 1. Define the Zod schema for validation
 * 2. Export the schema as a named const (e.g., `export const UserSchema = z.object(...)`)
 * 3. Extract the TypeScript type with `z.infer`
 * 4. Export the type for use in other modules
 * 5. Use the schema for runtime validation (parse/safeParse)
 *
 * ── Example ──
 *
 * ```typescript
 * import { z } from 'zod';
 * import type { Result } from './result.js';
 *
 * // 1. Schema
 * export const CreateUserSchema = z.object({
 *   username: z.string().min(2).max(20).regex(/^[a-zA-Z0-9_]+$/),
 *   password: z.string().min(4),
 * });
 *
 * // 2. Type
 * export type CreateUserInput = z.infer<typeof CreateUserSchema>;
 *
 * // 3. Validation function returning Result
 * export function validateCreateUser(input: unknown): Result<CreateUserInput> {
 *   const result = CreateUserSchema.safeParse(input);
 *   if (result.success) return { ok: true, data: result.data };
 *   return {
 *     ok: false,
 *     error: {
 *       code: 'VALIDATION',
 *       message: result.error.issues.map(i => i.message).join('; '),
 *       status: 400,
 *       details: { issues: result.error.issues },
 *     },
 *   };
 * }
 * ```
 */

export {};
