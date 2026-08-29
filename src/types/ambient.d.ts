/**
 * Deborah — Ambient Type Declarations for Legacy JS Modules
 *
 * These declarations allow TypeScript to understand imports from
 * existing JavaScript modules without requiring .d.ts files for each.
 *
 * As modules are migrated to TypeScript, their entries here should
 * be removed and replaced with proper typed exports.
 */

// ── Legacy server module ──
declare module '../../server.js' {
  import type { Express } from 'express';
  import type { Server as HttpServer } from 'http';
  import type { Server as SocketServer } from 'socket.io';

  export function createApp(): {
    app: Express;
    httpServer: HttpServer;
    io: SocketServer;
  };
}

// ── Legacy config modules ──
// Note: EnvConfig type is defined in src/contracts/env.ts (canonical source)
declare module '../../src/config/env.js' {
  const config: Record<string, unknown>;
  export default config;
  export function buildConfig(): Record<string, unknown>;
}

declare module '../../src/config/logger.js' {
  import type { Request, Response, NextFunction } from 'express';
  export function initLogger(opts?: { level?: string; pretty?: boolean }): ReturnType<typeof import('pino')>;
  export function getLogger(): ReturnType<typeof import('pino')>;
  export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void;
  export function requestLogMiddleware(): (req: Request, res: Response, next: NextFunction) => void;
}

declare module '../../src/config/features.js' {
  class FeatureFlags {
    isEnabled(name: string, tenantId?: string | null): boolean;
    setOverride(name: string, value: boolean | null): void;
    clearOverrides(): void;
    getAll(tenantId?: string | null): Record<string, { enabled: boolean; description: string; source: string }>;
  }
  const features: FeatureFlags;
  export default features;
  export { FeatureFlags };
}

// ── Legacy Firebase / DB ──
declare module '../../firebase/admin.js' {
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
  export const fb: FirebaseAdmin;
}

// ── Legacy middleware ──
declare module '../../middleware/auth.js' {
  import type { Request, Response, NextFunction } from 'express';
  export function requireAuth(req: Request, res: Response, next: NextFunction): void;
  export function requireAdmin(req: Request, res: Response, next: NextFunction): void;
  export function redirectIfAuth(req: Request, res: Response, next: NextFunction): void;
  export function redirectIfAdmin(req: Request, res: Response, next: NextFunction): void;
  export function setLocals(req: Request, res: Response, next: NextFunction): void;
}

// ── Legacy helpers ──
declare module '../../utils/helpers.js' {
  export function safeKey(str: string): string;
  export function hashPassword(password: string): Promise<string>;
  export function verifyPassword(password: string, hash: string): Promise<boolean>;
  export function isLegacyHash(hash: string): boolean;
  export function hashPass(password: string, salt: string): string;
  export function normalizeQuestion(q: unknown): unknown;
}

// ── Legacy socket handlers ──
declare module '../../socket/game-handler.js' {
  import type { Server as SocketServer, Socket } from 'socket.io';
  export function setupSocketHandlers(io: SocketServer, socket: Socket): void;
}


