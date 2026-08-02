/**
 * Edikit — Legacy JS Adapter Boundary
 *
 * Provides typed wrappers for importing legacy JavaScript modules
 * (routes/, middleware/, utils/, socket/, firebase/) from new TypeScript code.
 *
 * ── Rules ──
 * 1. Every legacy import used by new TS code goes through this file
 * 2. Each adapter may add runtime validation (Zod) for safety
 * 3. Legacy modules are NOT to be rewritten — only wrapped
 * 4. Return types come from ambient declarations (src/types/ambient.d.ts)
 *
 * ── Usage ──
 *   import { getAuthMiddleware } from './adapter.js';
 *   const auth = await getAuthMiddleware();
 *   auth.requireAuth(req, res, next);
 */

// Type-only imports from ambient declarations — erased at runtime
import type { Express, Request, Response, NextFunction } from 'express';

// ── Server factory ──
// Ambient: declare module '../../server.js' { function createApp(): { app: Express; httpServer: HttpServer; io: SocketServer } }

let _app: Express | null = null;
let _createApp: (() => ReturnType<typeof import('../../server.js')['createApp']>) | null = null;

/**
 * Get the Express app instance (lazy-loaded from legacy server.js).
 */
export async function getApp(): Promise<Express> {
  if (_app) return _app;

  if (!_createApp) {
    const serverModule = await import('../../server.js');
    _createApp = serverModule.createApp;
  }

  const result = await _createApp();
  _app = result.app;
  return _app;
}

// ── Config ──

/**
 * Get the runtime config (lazy-loaded from src/config/env.js).
 */
export async function getConfig(): Promise<Record<string, unknown>> {
  const CONFIG = await import('../../src/config/env.js');
  return CONFIG.default as Record<string, unknown>;
}

/**
 * Get the Pino logger module (lazy-loaded from src/config/logger.js).
 */
export async function getLogger(): Promise<{
  initLogger: (opts?: { level?: string; pretty?: boolean }) => ReturnType<typeof import('pino')>;
  getLogger: () => ReturnType<typeof import('pino')>;
  requestIdMiddleware: (req: Request, res: Response, next: NextFunction) => void;
  requestLogMiddleware: () => (req: Request, res: Response, next: NextFunction) => void;
}> {
  const loggerModule = await import('../../src/config/logger.js');
  return loggerModule as unknown as {
    initLogger: (opts?: { level?: string; pretty?: boolean }) => ReturnType<typeof import('pino')>;
    getLogger: () => ReturnType<typeof import('pino')>;
    requestIdMiddleware: (req: Request, res: Response, next: NextFunction) => void;
    requestLogMiddleware: () => (req: Request, res: Response, next: NextFunction) => void;
  };
}

/**
 * Get the feature flag service (lazy-loaded from src/config/features.js).
 */
export async function getFeatures(): Promise<{
  isEnabled: (name: string, tenantId?: string | null) => boolean;
  setOverride: (name: string, value: boolean | null) => void;
  clearOverrides: () => void;
  getAll: (tenantId?: string | null) => Record<string, { enabled: boolean; description: string; source: string }>;
}> {
  const featuresModule = await import('../../src/config/features.js');
  return featuresModule.default as unknown as {
    isEnabled: (name: string, tenantId?: string | null) => boolean;
    setOverride: (name: string, value: boolean | null) => void;
    clearOverrides: () => void;
    getAll: (tenantId?: string | null) => Record<string, { enabled: boolean; description: string; source: string }>;
  };
}

// ── Firebase / Local DB adapter ──

interface FirebaseSnapshot {
  exists(): boolean;
  val(): unknown;
}

interface FirebaseAdmin {
  get(path: string): Promise<FirebaseSnapshot>;
  set(path: string, data: unknown): Promise<void>;
  update(path: string, data: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
}

/**
 * Get the Firebase/Local DB adapter (lazy-loaded).
 */
export async function getDb(): Promise<FirebaseAdmin> {
  const fbModule = await import('../../firebase/admin.js');
  return (fbModule as { fb: FirebaseAdmin }).fb;
}

// ── Auth middleware ──

interface AuthMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
  redirectIfAuth: (req: Request, res: Response, next: NextFunction) => void;
  redirectIfAdmin: (req: Request, res: Response, next: NextFunction) => void;
  setLocals: (req: Request, res: Response, next: NextFunction) => void;
}

let _auth: AuthMiddleware | null = null;

export async function getAuthMiddleware(): Promise<AuthMiddleware> {
  if (_auth) return _auth;

  const authModule = await import('../../middleware/auth.js');
  _auth = authModule as unknown as AuthMiddleware;
  return _auth;
}

// ── Helpers ──

interface Helpers {
  safeKey(str: string): string;
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  isLegacyHash(hash: string): boolean;
  hashPass(password: string, salt: string): string;
  normalizeQuestion(q: unknown): unknown;
}

/**
 * Get the helpers module (lazy-loaded from utils/helpers.js).
 */
export async function getHelpers(): Promise<Helpers> {
  const helpers = await import('../../utils/helpers.js');
  return helpers as unknown as Helpers;
}

// ── Socket handler ──

import type { Server as SocketServer, Socket } from 'socket.io';

/**
 * Get the socket handler setup function (lazy-loaded from socket/game-handler.js).
 */
export async function getSocketHandler(): Promise<(io: SocketServer, socket: Socket) => void> {    const handler = await import('../../socket/game-handler.js');
  return (handler as unknown as { setupSocketHandlers: (io: SocketServer, socket: Socket, ...args: unknown[]) => void }).setupSocketHandlers;
}
