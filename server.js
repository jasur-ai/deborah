/**
 * Edikit — Node.js Express + Socket.io Server
 * Architecture: MllyCore-inspired modular pattern
 * 
 * Layers:
 *   1. Config & Dependencies
 *   2. Express setup (view engine, middleware, static)
 *   3. Route mounting
 *   4. Socket.io setup
 *   5. Error handling
 *   6. Start
 */

// ═══════════════════════════════════════════════════════════════
// 1. CONFIG & DEPENDENCIES
// ═══════════════════════════════════════════════════════════════

import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server } from 'socket.io';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { notFound, errorHandler, validateCsrf } from './middleware/error.js';
import { setLocals } from './middleware/auth.js';
import rateLimit from 'express-rate-limit';

// ── Routes ──
import indexRoutes from './routes/index.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import userRoutes from './routes/user.js';
import gameRoutes from './routes/game.js';
import arenaRoutes from './routes/arena.js';

// ── Socket handlers ──
import { setupSocketHandlers } from './socket/game-handler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ═══════════════════════════════════════════════════════════════
// 2. EXPRESS SETUP
// ═══════════════════════════════════════════════════════════════

// ── View engine ──
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));

// ── Security & parsing middleware ──
app.use(helmet({
  contentSecurityPolicy: false, // Socket.io CDN + EJS inline scripts
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(morgan(IS_PROD ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Session ──
app.use(session({
  secret: process.env.SESSION_SECRET || 'edikit-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: IS_PROD,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
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

// ── CSRF validation (skip socket.io, static files, and API endpoints) ──
app.use((req, res, next) => {
  // Skip CSRF for socket.io, static files, GET/HEAD/OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/socket.io/')) return next();
  if (req.path.startsWith('/css/') || req.path.startsWith('/js/') ||
      req.path.startsWith('/images/') || req.path.startsWith('/characters/')) return next();
  // Skip API endpoints — client-side fetch() calls need CSRF header integration
  if (req.path.startsWith('/api/') || req.path.startsWith('/arena/api/') ||
      req.path.startsWith('/admin/api/') || req.path.startsWith('/user/api/')) return next();
  validateCsrf(req, res, next);
});

// ── Rate limiting for login routes (POST only) ──
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                    // 20 POST attempts per window
  skip: (req) => req.method !== 'POST',
  message: { error: 'Ko\'p urinish. Iltimos, 15 daqiqa kuting.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiter to login routes
app.use('/admin/login', loginLimiter);
app.use('/user/login', loginLimiter);

// ── Locals for EJS views ──
app.use(setLocals);

// ── Static files ──
// Public assets (css, js, images, etc.)
app.use(express.static(join(__dirname, 'public'), {
  maxAge: IS_PROD ? '1d' : 0,
}));


// Characters directory
app.use('/characters', express.static(join(__dirname, 'characters'), {
  maxAge: IS_PROD ? '7d' : 0,
}));

// Favicon
app.get('/favicon.ico', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'images', 'logo-icon.svg'));
});

// ═══════════════════════════════════════════════════════════════
// 3. ROUTES
// ═══════════════════════════════════════════════════════════════

app.use('/', indexRoutes);
app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/user', userRoutes);
app.use('/', gameRoutes);
app.use('/arena', arenaRoutes);

// ═══════════════════════════════════════════════════════════════
// 4. SOCKET.IO
// ═══════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  setupSocketHandlers(io, socket);
});

// ═══════════════════════════════════════════════════════════════
// 5. ERROR HANDLING
// ═══════════════════════════════════════════════════════════════

app.use(notFound);
app.use(errorHandler);

// ═══════════════════════════════════════════════════════════════
// 6. START
// ═══════════════════════════════════════════════════════════════

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   ⚡ Edikit v2.0                       ║
║   ─────────────────────────────────────── ║
║   Server:   http://localhost:${PORT}         ║
║   Status:   ${IS_PROD ? 'PRODUCTION' : 'DEVELOPMENT'}                    ║
║   Engine:   ${process.version}                       ║
║   Socket:   Socket.io ${io.version || '4.x'}                ║
╚═══════════════════════════════════════════╝
  `);
});

export { app, httpServer, io };
