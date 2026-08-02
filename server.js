/**
 * Edikit — Node.js Express + Socket.io Server
 * Architecture: MllyCore-inspired modular pattern
 * 
 * Layers:
 *   1. Config & Dependencies (Zod env, Pino logger, Feature flags)
 *   2. Express setup (view engine, middleware, static)
 *   3. Route mounting
 *   4. Socket.io setup
 *   5. Error handling
 *   6. Start
 *
 * Test factory: createApp() — exports app + io without listening
 */

// ═══════════════════════════════════════════════════════════════
// 1. CONFIG & DEPENDENCIES
// ═══════════════════════════════════════════════════════════════

import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import { Server } from 'socket.io';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ── Edikit config modules ──
import CONFIG from './src/config/env.js';
import { initLogger, getLogger, requestIdMiddleware, requestLogMiddleware } from './src/config/logger.js';
import features from './src/config/features.js';

// ── Middleware ──
import { notFound, errorHandler, validateCsrf } from './middleware/error.js';
import { setLocals } from './middleware/auth.js';
import { originCheck } from './middleware/origin-check.js';

// ── Telemetry (Prompt 69 — OTel-style observability) ──
import { telemetryMiddleware, wrapSocketEvent } from './middleware/telemetry.js';
import { incrementCounter, setGauge } from './src/telemetry/index.js';
import observabilityRoutes from './routes/observability.js';

// ── Routes ──
import indexRoutes from './routes/index.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import userRoutes from './routes/user.js';
import gameRoutes from './routes/game.js';
import arenaRoutes from './routes/arena.js';
import oidcRoutes from './routes/oidc.js';
import academicRoutes from './routes/academic.js';
import rosterRoutes from './routes/roster.js';
import accommodationRoutes from './routes/accommodation.js';
import competencyRoutes from './routes/competency.js';
import itemBankRoutes from './routes/item-bank.js';
import rubricRoutes from './routes/rubric.js';
import qtiRoutes from './routes/qti.js';
import assessmentRoutes from './routes/assessment.js';
import briefRoutes from './routes/brief.js';
import calendarRoutes from './routes/calendar.js';
import schedulerRoutes from './routes/scheduler.js';
import seatingRoutes from './routes/seating.js';
import commandCenterRoutes from './routes/command-center.js';
import paperRoutes from './routes/paper.js';
import scanRoutes from './routes/scan.js';
import safeSubmitRoutes from './routes/safe-submit.js';
import gradingRoutes from './routes/grading.js';
import markingRoutes from './routes/marking.js';
import boardRoutes from './routes/board.js';
import considerationRoutes from './routes/consideration.js';
import sourcePackRoutes from './routes/source-pack.js';
import aiGradingRoutes from './routes/ai-grading.js';
import aiMlopsRoutes from './routes/ai-mlops.js';
import aiQuestionGenRoutes from './routes/ai-question-gen.js';
import resourceRecoRoutes from './routes/resource-reco.js';
import interventionRoutes from './routes/intervention.js';
import presentationRoutes from './routes/presentation.js';
import claudeRoutes from './routes/claude.js';
import providerRoutes from './routes/provider.js';
import canvaRoutes from './routes/canva.js';
import googleSlidesRoutes from './routes/google-slides.js';
import deckExportRoutes from './routes/deck-export.js';
import quizDeckRoutes from './routes/quiz-deck.js';
import aiCheckpointRoutes from './routes/ai-checkpoint.js';
import credentialRoutes from './routes/credential.js';
import programQualityRoutes from './routes/program-quality.js';
import multilingualRoutes from './routes/multilingual.js';
import accessibilityRoutes from './routes/accessibility.js';
import dataGovernanceRoutes from './routes/data-governance.js';
import externalIntegrationRoutes from './routes/external-integration.js';
import apiContractsRoutes from './routes/api-contracts.js';
import publishRoutes from './routes/publish.js';
import preflightRoutes from './routes/preflight.js';
import attemptRoutes from './routes/attempt.js';
import responseRoutes from './routes/response.js';
import offlineRoutes from './routes/offline.js';
import submitRoutes from './routes/submit.js';
import proctorRoutes from './routes/proctor.js';
import securityRoutes from './routes/security.js';
import securityGuardRoutes from './routes/security-guard.js';
import reliabilityRoutes from './routes/reliability.js';
import cameraRoutes from './routes/camera.js';
import rolesRoutes from './routes/roles.js';
import institutionalRoutes from './routes/institutional.js';
import acceptanceRoutes from './routes/acceptance.js';

// ── Rate limiting ──
import rateLimit from 'express-rate-limit';
import { HTTP_LIMITS } from './src/config/rate-limiter.js';
import { createSocketRateLimiter } from './middleware/socket-rate-limiter.js';

// ── Socket handlers ──
import { setupSocketHandlers } from './socket/game-handler.js';

// ── Brief/Policy recipe seeding ──
import { seedRecipeLibrary } from './src/modules/brief/policy.service.js';

// ── Socket identity (HMAC tickets + host grants) ──
import { createSocketIdentity } from './middleware/socket-identity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Create the Express + Socket.io application without starting the HTTP server.
 * Use this in tests to avoid port conflicts.
 */
export async function createApp() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── Logger setup (first middleware) ──
  initLogger({ level: CONFIG.LOG_LEVEL, pretty: CONFIG.LOG_PRETTY });
  const log = getLogger();
  app.use(requestIdMiddleware);

  // ── Telemetry trace middleware (HTTP spans + metrics + traceparent) ──
  app.use(telemetryMiddleware);

  // ── View engine ──
  app.set('view engine', 'ejs');
  app.set('views', join(__dirname, 'views'));

  // ── Trust proxy (Render/Railway/Vercel orqasida HTTPS ulanish) ──
  // Express reverse-proxy orqasida ishlaganda 'secure' cookie'ni to'g'ri
  // yuborishi uchun kerak. Bo'lmasa secure:true cookie umuman yuborilmaydi
  // va CSRF token sessiyada saqlanmaydi → "CSRF token validation failed".
  app.set('trust proxy', 1);

  // ── Security & parsing middleware ──
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  // rawBody capture — Manus signed webhook HMAC tekshiruvi uchun (Prompt 58 §11)
  app.use(express.json({ limit: '10mb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.use(express.urlencoded({ extended: true, limit: '10mb', verify: (req, res, buf) => { req.rawBody = req.rawBody || buf.toString('utf8'); } }));

  // ── Session (Redis or MemoryStore) ──
  let sessionStore;
  if (CONFIG.REDIS_URL) {
    try {
      const { default: RedisStore } = await import('connect-redis');
      const { Redis } = await import('ioredis');
      const redisClient = new Redis(CONFIG.REDIS_URL, {
        lazyConnect: true,
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 100, 3000),
      });
      await redisClient.connect();
      sessionStore = new RedisStore({ client: redisClient, prefix: 'edikit:sess:' });
      log.info('Redis session store connected');
    } catch (err) {
      log.warn({ err: err.message }, 'Redis session store unavailable, using MemoryStore');
      sessionStore = new session.MemoryStore();
    }
  }

  app.use(session({
    store: sessionStore,
    secret: CONFIG.SESSION_SECRET,
    resave: false,
    // saveUninitialized: true — CSRF token sessiyada saqlanishi uchun.
    // false bo'lsa express-session yangi sessiyani saqlamaydi va cookie
    // yozmaydi → brauzerda session yo'q → POST'da CSRF token tekshiruvi
    // yiqiladi ("CSRF token validation failed" 403).
    saveUninitialized: true,
    cookie: {
      secure: CONFIG.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: CONFIG.SESSION_MAX_AGE,
      sameSite: 'strict',
    },
  }));

  // ── CSRF token generation ──
  app.use((req, res, next) => {
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.locals.csrfToken = req.session.csrfToken;
    next();
  });

  // ── Origin/Referer allowlist check (before CSRF) ──
  app.use(originCheck);

  // ── CSRF validation (active on ALL state-changing POST/PUT/PATCH/DELETE) ──
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.path.startsWith('/socket.io/')) return next();
    if (req.path.startsWith('/css/') || req.path.startsWith('/js/') ||
        req.path.startsWith('/images/') || req.path.startsWith('/characters/')) return next();
    // Provider webhook — HMAC signature bilan himoyalangan, CSRF token shart emas
    // (Prompt 58 §11 — Manus signed webhook)
    if (req.path.startsWith('/api/webhooks/')) return next();
    // API endpoints are now CSRF-protected — clients must send X-CSRF-Token header
    validateCsrf(req, res, next);
  });

  // ── Rate limiting for HTTP endpoints ──
  // Login brute-force protection
  const loginLimiter = rateLimit({
    ...HTTP_LIMITS.login,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/admin/login', loginLimiter);
  app.use('/user/login', loginLimiter);

  // Admin API rate limiting
  const adminApiLimiter = rateLimit({
    ...HTTP_LIMITS.adminApi,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/admin/api', adminApiLimiter);

  // User API rate limiting
  const userApiLimiter = rateLimit({
    ...HTTP_LIMITS.userApi,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/user/api', userApiLimiter);

  // General API rate limiter (all POST/PUT/PATCH/DELETE)
  const generalLimiter = rateLimit({
    ...HTTP_LIMITS.general,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
  });
  app.use(generalLimiter);

  // ── Locals for EJS views ──
  app.use(setLocals);

  // ── Static files ──
  app.use(express.static(join(__dirname, 'public'), {
    maxAge: CONFIG.NODE_ENV === 'production' ? '1d' : 0,
  }));
  app.use('/characters', express.static(join(__dirname, 'characters'), {
    maxAge: CONFIG.NODE_ENV === 'production' ? '7d' : 0,
  }));
  app.get('/favicon.ico', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'images', 'logo-icon.svg'));
  });

  // ── Health / Readiness endpoints ──
  app.get('/health', (req, res) => {
    const rateLimiterStats = app.get('socketRateLimiter')?.getStats?.() || null;
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Date.now(),
      node: process.version,
      env: CONFIG.NODE_ENV,
      features: features.getAll(),
      rateLimiter: rateLimiterStats,
    });
  });

  app.get('/ready', (req, res) => {
    // Readiness check — DB is loaded, server is accepting connections
    res.json({
      status: 'ready',
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  });

  // ── Routes ──
  app.use('/', indexRoutes);
  app.use('/', authRoutes);
  app.use('/admin', adminRoutes);
  app.use('/user', userRoutes);
  app.use('/', gameRoutes);
  app.use('/arena', arenaRoutes);
  app.use('/', oidcRoutes);

  // ── Academic API routes ──
  app.use('/', academicRoutes);

  // ── Roster upload API routes ──
  app.use('/', rosterRoutes);

  // ── Accommodation API routes ──
  app.use('/', accommodationRoutes);

  // ── Competency API routes ──
  app.use('/', competencyRoutes);

  // ── Item Bank API routes ──
  app.use('/', itemBankRoutes);

  // ── Rubric Builder API routes ──
  app.use('/', rubricRoutes);

  // ── QTI Import/Export API routes ──
  app.use('/', qtiRoutes);

  // ── Assessment Builder & Blueprint API routes ──
  app.use('/', assessmentRoutes);

  // ── Brief, Policy Pack & Simulator API routes ──
  app.use('/', briefRoutes);

  // ── Program Calendar & Workload API routes ──
  app.use('/', calendarRoutes);
  app.use('/', schedulerRoutes);
  app.use('/', seatingRoutes);
  app.use('/', commandCenterRoutes);
  app.use('/', paperRoutes);
  app.use('/', scanRoutes);
  app.use('/', safeSubmitRoutes);
  app.use('/', gradingRoutes);
  app.use('/', markingRoutes);
  app.use('/', boardRoutes);
  app.use('/', considerationRoutes);

  // ── Immutable Publish Transaction & Assignment Snapshot API routes ──
  app.use('/', sourcePackRoutes);
  app.use('/', aiGradingRoutes);
  app.use('/', aiMlopsRoutes);
  app.use('/', aiQuestionGenRoutes);
  app.use('/', resourceRecoRoutes);
  app.use('/', interventionRoutes);
  app.use('/', presentationRoutes);
  app.use('/', claudeRoutes);
  app.use('/', providerRoutes);
  app.use('/', canvaRoutes);
  app.use('/', googleSlidesRoutes);
  app.use('/', deckExportRoutes);
  app.use('/', quizDeckRoutes);
  app.use('/', aiCheckpointRoutes);
  app.use('/', credentialRoutes);
  app.use('/', programQualityRoutes);
  app.use('/', multilingualRoutes);
  app.use('/', accessibilityRoutes);
  app.use('/', dataGovernanceRoutes);
  app.use('/', externalIntegrationRoutes);
  app.use('/', apiContractsRoutes);
  app.use('/', preflightRoutes);
  app.use('/', attemptRoutes);
  app.use('/', responseRoutes);
  app.use('/', offlineRoutes);
  app.use('/', submitRoutes);
  app.use('/', proctorRoutes);
  app.use('/', securityRoutes);
  app.use('/', securityGuardRoutes);
  app.use('/', reliabilityRoutes);
  app.use('/', cameraRoutes);

  // ── Role workspace routes (Prompt 68 — role-aware shell) ──
  app.use('/', rolesRoutes);

  // ── Institutional handoff routes (Prompt 72 — final migration/pilot/procurement) ──
  app.use('/', institutionalRoutes);

  // ── Final system acceptance routes (Prompt 73 — release sign-off) ──
  app.use('/', acceptanceRoutes);

  // ── Observability routes (Prompt 69 — SLO dashboard) ──
  app.use('/admin', observabilityRoutes);

  // ── Security Guard routes (Prompt 70 — threat model/ASVS/findings/red-team) ──
  // (fully qualified /admin/... routes, already mounted at '/' — no duplicate mount)

  // ── Reliability Guard routes (Prompt 71 — load/chaos/backup/DR/release) ──
  // (routes are fully qualified /admin/... so mounted at '/' only)

  // ── Request log middleware (logs completed requests) ──
  app.use(requestLogMiddleware());

  // ── Socket identity (HMAC tickets + host grants) ──
  const socketIdentity = createSocketIdentity(CONFIG.SESSION_SECRET);
  socketIdentity.apply(io);

  // ── Socket.io with rate limiting ──
  const socketRateLimiter = createSocketRateLimiter();
  socketRateLimiter.apply(io);

  io.on('connection', (socket) => {
    log.info({ event: 'socket:connect', id: socket.id }, `Socket connected: ${socket.id}`);

    // ── Socket connection metrics (Prompt 69 §10 golden signals) ──
    incrementCounter('edikit_socket_connections_total', { help: 'Socket connections' }, { value: 1 });
    const connCount = (io.sockets?.sockets?.size || 0);
    setGauge('edikit_socket_connected', connCount, { help: 'Current socket connections' });

    // ── Socket event manual spans (Prompt 69 §09) ──
    // Har bir event handler'ini wrap qilamiz — span'da PII yozilmaydi
    // (faqat socket.id + event nomi, research §38.3).
    const origOn = socket.on.bind(socket);
    socket.on = (event, handler) => origOn(event, wrapSocketEvent(socket, event, handler));

    // Pass rate limiter + identity to game handlers
    setupSocketHandlers(io, socket, socketRateLimiter, socketIdentity);

    socket.on('disconnect', (reason) => {
      socketRateLimiter.onDisconnect(socket);
      const remaining = (io.sockets?.sockets?.size || 0);
      setGauge('edikit_socket_connected', remaining, { help: 'Current socket connections' });
      log.info({ event: 'socket:disconnect', id: socket.id, reason }, `Socket disconnected: ${socket.id}`);
    });
  });

  // Make rate limiter + identity available for health endpoint
  app.set('socketRateLimiter', socketRateLimiter);
  app.set('socketIdentity', socketIdentity);

  // ── Error handling ──
  app.use(notFound);
  app.use(errorHandler);

  // ── Idempotent system recipe seeding (best-effort, non-blocking) ──
  seedRecipeLibrary().catch((err) => {
    log.warn({ err: err.message }, 'Recipe library seed skipped (PostgreSQL unavailable?)');
  });

  return { app, httpServer, io };
}

// ═══════════════════════════════════════════════════════════════
// 6. START (only when run directly, not when imported)
// ═══════════════════════════════════════════════════════════════

const isMainModule = process.argv[1] &&
  (fileURLToPath(import.meta.url) === process.argv[1] ||
   fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/'));

if (isMainModule) {
  // ── Startup blocker: prevent running with defaults in production ──
  if (CONFIG.NODE_ENV === 'production') {
    if (CONFIG.ADMIN_USER === 'admin' || CONFIG.ADMIN_PASS === 'admin') {
      console.error('\n❌ FATAL: Default admin credentials in production!');
      console.error('   Set ADMIN_USER and ADMIN_PASS in .env to non-default values.\n');
      process.exit(1);
    }
    if (CONFIG.SESSION_SECRET === 'edikit-dev-secret') {
      console.error('\n❌ FATAL: Default session secret in production!');
      console.error('   Set a unique SESSION_SECRET in .env.\n');
      process.exit(1);
    }
  }

  const { httpServer: server, io } = await createApp();
  
  server.listen(CONFIG.PORT, CONFIG.HOST, () => {
    const log = getLogger();
    log.info({
      event: 'server:start',
      port: CONFIG.PORT,
      host: CONFIG.HOST,
      env: CONFIG.NODE_ENV,
      node: process.version,
    }, `Server started on http://${CONFIG.HOST}:${CONFIG.PORT}`);

    console.log(`
╔═══════════════════════════════════════════╗
║   ⚡ Edikit v2.0                       ║
║   ─────────────────────────────────────── ║
║   Server:   http://${CONFIG.HOST}:${CONFIG.PORT}         ║
║   Status:   ${CONFIG.NODE_ENV.toUpperCase()}                    ║
║   Engine:   ${process.version}                       ║
║   Socket:   Socket.io 4.x                ║
╚═══════════════════════════════════════════╝
  `);
  });
}
