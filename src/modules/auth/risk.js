/**
 * Deborah — Risk-based authentication service (AUTH A-28)
 * -------------------------------------------------------------------
 * AUTH A-28 (guide §06-§17, §29-§30):
 *   - Device fingerprint (client'da hash, server'ga faqat hash — raw telemetry
 *     hech qachon kelmaydi) + server-side signals → risk score 0-1.
 *   - Risk tiers (fluxforce — binary emas):
 *       < 0.3  trusted    → seamless
 *       0.3-0.7 unknown   → step-up (MFA mavjud bo'lsa A-26 flow; aks holda
 *                            session.riskStepup + throttling)
 *       > 0.7  suspicious → block + alert
 *   - Impossible travel: server-side (IP geolocation lokal DB + timestamp) —
 *     client'ga ishonilmaydi. Haversine masofa / vaqt → tezlik > threshold
 *     → signal. Faqat AGREGAT (shahar) ishlatiladi — IP hech qachon emas.
 *   - Velocity: bitta qurilma (fingerprint) 10 daqiqada ≥3 turli IP.
 *   - Privacy: fingerprint hash (raw emas), risk_events hash'da saqlanadi,
 *     retention: oxirgi 20 event (slice), UZ'da saqlanadi, DSAR user bilan.
 *   - Threshold'lar config'da (tenant sozlashi) — env'dan, default bilan.
 *
 * Stop condition: fingerprint yagona qaror EMAS (server signals qo'shiladi);
 * raw telemetry saqlanmaydi.
 */
import { fb } from '../../../firebase/admin.js';
import CONFIG from '../../config/env.js';
import { audit, AUDIT_ACTIONS, logAuthEvent } from './audit.js';
import { ipHash } from './new-device.js';
import { cityFromIp } from './geo-lite.js';
import { recordMetric } from '../../telemetry/index.js';
import { getDevice, touchDevice, setDeviceTrusted } from './device-fingerprint.js';

// ── Threshold'lar (config — tenant sozlashi, guide §29) ──
const TRUSTED_MAX = CONFIG.RISK_TRUSTED_MAX ?? 0.3; // < 0.3 → trusted
const SUSPICIOUS_MIN = CONFIG.RISK_SUSPICIOUS_MIN ?? 0.7; // > 0.7 → suspicious
// Impossible-travel: tezlik (km/soat). Toshkent→London (~4900 km) 10 daqiqada
// → ~29400 km/h » threshold — signal. Reaktiv samolyot ~900 km/h.
// C-05 §06: > 800 km/soat → flag (spec — 900'dan qattiqroq).
const TRAVEL_SPEED_KMH = CONFIG.RISK_TRAVEL_SPEED_KMH ?? 800;
const VELOCITY_WINDOW_MS = 10 * 60 * 1000; // 10 daqiqa oyna (C-05 §09)
const VELOCITY_DISTINCT_IPS = 3; // ≥3 turli IP → velocity (device-level)
const VELOCITY_DISTINCT_DEVICES = 3; // ≥3 turli qurilma → velocity (account-level)
const RISK_EVENTS_MAX = 20; // retention (guide §14 — qisqa)

// Redis velocity counter'lar (C-05 §09) — bir account ko'p qurilma pattern.
// Redis mavjud bo'lmasa fail-open (signal yo'q — server yukini oshirmaydi).
const VELOCITY_REDIS_KEY = (userId) => `auth:vel:acct:${userId}`;

// ── Signal weights (guide §08) ──
export const RISK_SIGNAL_WEIGHTS = {
  new_device: 0.3, // fingerprint mismatch (yangi qurilma)
  impossible_travel: 0.5, // geo+ts: Toshkent → 10 daqiqada London
  velocity: 0.4, // bir device ko'p IP
  vpn_proxy: 0.3, // VPN/proxy signal (server-side)
  bot: 0.6, // bot detected (Turnstile — P2, header signal)
  dev_tools: 0.2, // dev tools / automation signal
  account_age: 0.2, // C-04: account < 7 kun — yangi akkauntlar yuqori xavf
  trusted_device: -0.4, // user tasdiqlagan qurilma
};

// ── Per-role thresholds (guide §29 — admin qattiq) ──
// Admin'lar yuqori imtiyozli — oddiy foydalanuvchidan qattiqroq chegaralar.
const ROLE_THRESHOLDS = {
  // default: C-04 §07 — <0.3 trusted, 0.3-0.7 unknown, >0.7 suspicious
  default: { trustedMax: CONFIG.RISK_TRUSTED_MAX ?? 0.3, suspiciousMin: CONFIG.RISK_SUSPICIOUS_MIN ?? 0.7 },
  // admin: qattiq — <0.2 trusted, >0.5 suspicious (MFA step-up pastroq skor'da)
  admin: { trustedMax: 0.2, suspiciousMin: 0.5 },
  // teacher: o'rtacha — trusted default, suspicious 0.6 (o'quv materiallari)
  teacher: { trustedMax: 0.3, suspiciousMin: 0.6 },
};

/** Role uchun threshold'lar — noma'lum role → default. */
export function riskThresholds(role) {
  return ROLE_THRESHOLDS[role] || ROLE_THRESHOLDS.default;
}

// ── Shahar koordinatalari (haversine — faqat AGREGATlar) ──
// Geo-lite lokal DB'da bo'lmagan shahar → qoida fail-safe (signal yo'q).
const CITY_COORDS = {
  Toshkent: [41.3, 69.2],
  Samarqand: [39.65, 66.96],
  Andijon: [40.78, 72.34],
  Nukus: [42.46, 59.6],
  London: [51.5, -0.12],
  Moskva: [55.75, 37.61],
  Istanbul: [41.0, 28.95],
  Dubay: [25.2, 55.27],
  Seul: [37.56, 126.97],
  Tokio: [35.68, 139.69],
  Nyu_York: [40.71, -74.0],
};

/** Haversine masofa (km) — ikki koordinata orasida. */
export function haversineKm([lat1, lon1], [lat2, lon2]) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Impossible-travel tekshiruvi: ikki shahar orasidagi masofa / vaqt oralig'i
 * → tezlik. Tezlik threshold'dan yuqori → false (impossible).
 * Noma'lum shahar/koordinata → true (fail-safe — signal yo'q).
 */
export function travelFeasible({ fromCity, fromAt, toCity, toAt, maxSpeedKmh = TRAVEL_SPEED_KMH }) {
  if (!fromCity || !toCity || fromCity === toCity) return true;
  if (!fromAt || !toAt) return true;
  const c1 = CITY_COORDS[fromCity];
  const c2 = CITY_COORDS[toCity];
  if (!c1 || !c2) return true;
  const dist = haversineKm(c1, c2);
  if (dist < 1) return true; // bir xil shahar (taxminiy koordinatalar)
  const hours = Math.max((toAt - fromAt) / 3600000, 0.0001); // min 0.36s
  const speed = dist / hours;
  return speed <= maxSpeedKmh;
}

/** Risk tier — fluxforce (binary emas). Per-role threshold (guide §29). */
export function riskTier(score, role) {
  const { trustedMax, suspiciousMin } = riskThresholds(role);
  if (score < trustedMax) return 'trusted';
  if (score <= suspiciousMin) return 'unknown';
  return 'suspicious';
}

/** Tier → action. */
export function riskAction(tier) {
  if (tier === 'suspicious') return 'block';
  if (tier === 'unknown') return 'stepup';
  return 'allow';
}

/**
 * Signal'lar → score (0-1) + tier + active signal list.
 * Pure funksiya — test oson.
 * @param {Object} signals — { new_device?, impossible_travel?, velocity?, vpn_proxy?, bot?, dev_tools?, account_age?, trusted_device? }
 * @param {string} [role] — per-role thresholds (guide §29; admin qattiq).
 * @returns {{ score: number, tier: string, signals: string[] }}
 */
export function computeRiskScore(signals = {}, role) {
  let score = 0;
  const active = [];
  for (const [name, weight] of Object.entries(RISK_SIGNAL_WEIGHTS)) {
    if (signals[name]) {
      score += weight;
      active.push(name);
    }
  }
  score = Math.max(0, Math.min(1, score));
  // High-confidence signal (impossible_travel/bot) trusted discount bilan
  // to'liq o'chib ketmasin — o'g'irlangan trusted qurilma impossible travel
  // bilan seamless o'tmasligi uchun tier kamida 'unknown' (floor 0.3).
  if ((signals.impossible_travel || signals.bot) && score < 0.3) {
    score = 0.3;
  }
  // D-33: tier qaytarilgan (yaxlitlangan) score'dan hisoblanadi — aks holda
  // chegara yaqinida tier va score mos kelmasligi mumkin (invariant buzilishi).
  const rounded = Math.round(score * 100) / 100;
  const tier = riskTier(rounded, role);
  return { score: rounded, tier, signals: active };
}

// ── Device (user_devices) — storage device-fingerprint.js'da ──
// Re-export: routes bitta manbadan (risk.js) import qiladi.
export { getDevice, touchDevice, setDeviceTrusted, listDevices, isFingerprintHash } from './device-fingerprint.js';

/**
 * Risk holatini baholaydi — server-side signals yig'adi, score/tier qaytaradi.
 *
 * @param {{
 *   userId: string,
 *   fingerprintHash?: string|null,
 *   ipAddress?: string,
 *   userAgent?: string,
 *   prevLoginState?: { ipHash?: string, city?: string|null, at?: number }|null,
 *   extraSignals?: { vpnProxy?: boolean, bot?: boolean, devTools?: boolean }
 * }} params
 * @returns {Promise<{ score: number, tier: string, action: string, signals: string[],
 *   isNewDevice: boolean, trusted: boolean, device: object|null }>}
 */
export async function evaluateRisk({ userId, fingerprintHash, ipAddress, userAgent, prevLoginState, extraSignals, userCreatedAt, redis = null, redisOk = false }) {
  const signals = {};
  const now = Date.now();
  const device = fingerprintHash ? await getDevice(userId, fingerprintHash) : null;

  // 1) Yangi qurilma (fingerprint mismatch — user_devices'da yo'q) +0.3
  const isNewDevice = !!fingerprintHash && !device;
  if (isNewDevice) signals.new_device = true;

  // 2) Trusted device (user tasdiqlagan) -0.4
  const trusted = device?.trusted === true;
  if (trusted) signals.trusted_device = true;

  // C-04 §06: account_age < 7 kun → +0.2 (yangi akkauntlar — o'g'irlangan
  // akkauntlar odatda yangi qurilmalardan, lekin yangi akkauntning o'zi
  // ham yuqori xavf: tez-tez qayta ro'yxatdan o'tish spam/abuse signali).
  if (typeof userCreatedAt === 'number' && userCreatedAt > 0 && now - userCreatedAt < 7 * 24 * 3600 * 1000) {
    signals.account_age = true;
  }

  // 3) Impossible travel (server-side: device last_city/last_seen vs hozir) +0.5
  // Record formati snake_case (device-fingerprint.js touchDevice).
  const city = cityFromIp(ipAddress);
  const devCity = device?.last_city ?? device?.lastCity;
  const devSeen = device?.last_seen ?? device?.lastSeenAt;
  if (devCity && devSeen) {
    if (city && city !== devCity) {
      if (!travelFeasible({ fromCity: devCity, fromAt: devSeen, toCity: city, toAt: now })) {
        signals.impossible_travel = true;
      }
    }
  }
  // Fallback: prevLoginState (users.last_city / last_login_at) — A-09 state
  if (!signals.impossible_travel && prevLoginState?.city && prevLoginState?.at) {
    if (city && city !== prevLoginState.city) {
      if (!travelFeasible({ fromCity: prevLoginState.city, fromAt: prevLoginState.at, toCity: city, toAt: now })) {
        signals.impossible_travel = true;
      }
    }
  }

  // 4) Velocity: bir device 10 daqiqada ≥3 turli IP (risk_events — hash'lar) +0.4
  const devEvents = device?.risk_events ?? device?.riskEvents;
  if (devEvents?.length) {
    const recent = devEvents.filter((e) => e.at && now - e.at < VELOCITY_WINDOW_MS);
    const distinctIps = new Set(recent.map((e) => e.ipHash).filter(Boolean));
    if (distinctIps.size >= VELOCITY_DISTINCT_IPS) signals.velocity = true;
  }

  // 5) Server-side extra signals (header'lar — client ishonilmaydi)
  if (extraSignals?.vpnProxy) signals.vpn_proxy = true;
  if (extraSignals?.bot) signals.bot = true;
  if (extraSignals?.devTools) signals.dev_tools = true;

  // C-05 §09: account-level velocity — bir account'da 10 daqiqada ≥3 turli
  // qurilma (Redis SET — counter, raw PII yo'q: faqat fingerprint hash).
  // Redis mavjud bo'lmasa fail-open (signal yo'q — §23 fail-open kontrakti).
  if (redisOk && redis && fingerprintHash) {
    try {
      const key = VELOCITY_REDIS_KEY(userId);
      await redis.sadd(key, fingerprintHash);
      await redis.expire(key, Math.ceil(VELOCITY_WINDOW_MS / 1000)); // 10 daqiqa
      const deviceCount = await redis.scard(key);
      if (deviceCount >= VELOCITY_DISTINCT_DEVICES) signals.velocity = true;
    } catch (_) { /* fail-open */ }
  }

  const { score, tier, signals: active } = computeRiskScore(signals);
  return {
    score,
    tier,
    action: riskAction(tier),
    signals: active,
    isNewDevice,
    trusted,
    device,
    fingerprintHash: fingerprintHash ?? null, // session'ga yozish uchun (hash only)
  };
}

/**
 * Risk qarorini record qiladi: audit + metrics + device record (touch).
 * Login'da har doim chaqiriladi (seamless ham record) — tuning logs (guide §29).
 *
 * @param {{ userId: string, fingerprintHash?: string|null, score: number, tier: string,
 *   action: string, signals: string[], ipAddress?: string, userAgent?: string, blocked?: boolean }} params
 */
export async function recordRiskDecision({ userId, fingerprintHash, score, tier, action, signals, ipAddress, userAgent, blocked }) {
  if (!userId) return;
  const details = { score, tier, action, signals };

  // C-05 §12: impossible_travel / velocity alohida audit event'lar (signal
  // nomi bilan) — tuning va false-positive izlash uchun. Raw geo yo'q:
  // faqat user_id (hash scope) + signal + ts.
  for (const sig of signals) {
    if (sig === 'impossible_travel') {
      await logAuthEvent({
        action: AUDIT_ACTIONS.IMPOSSIBLE_TRAVEL_DETECTED,
        outcome: 'detected',
        method: 'risk',
        actorId: userId,
        ipAddress,
        userAgent,
        details: { city: 'aggregate', ts: Date.now() },
      }).catch(() => {});
    } else if (sig === 'velocity') {
      await logAuthEvent({
        action: AUDIT_ACTIONS.VELOCITY_DETECTED,
        outcome: 'detected',
        method: 'risk',
        actorId: userId,
        ipAddress,
        userAgent,
        details: { pattern: 'multi_source', ts: Date.now() },
      }).catch(() => {});
    }
  }

  // C-04 review fix: `auth_audit`'ga yoziladi (A-03/C-02 kontrakti —
  // audit() PostgreSQL audit_log'ga yozadi, auth flow yagona manba
  // auth_audit: logAuthEvent). Izchillik uchun shu yerga ham.
  await logAuthEvent({
    action: blocked ? AUDIT_ACTIONS.RISK_BLOCKED : AUDIT_ACTIONS.RISK_SCORED,
    outcome: blocked ? 'blocked' : 'success',
    method: 'risk',
    actorId: userId,
    ipAddress,
    userAgent,
    details,
  }).catch(() => {});
  // PG audit_log'ga ham (tenant scope) — ikkalasi parallel, fail-soft
  await audit({
    action: blocked ? AUDIT_ACTIONS.RISK_BLOCKED : AUDIT_ACTIONS.RISK_SCORED,
    userId,
    resourceType: 'auth',
    ipAddress,
    userAgent,
    details,
  }).catch(() => {});

  try {
    if (blocked) {
      recordMetric('auth.risk_blocked', 1, { type: 'counter', labels: { tier } });
      // AUTH D-06 §06: auth_risk_block_total (risk block spike alert)
      recordMetric('auth_risk_block_total', 1, { type: 'counter', labels: { tier } });
    } else if (tier === 'unknown') {
      recordMetric('auth.risk_stepup', 1, { type: 'counter', labels: { signals: signals.join(',') } });
    } else {
      recordMetric('auth.risk_scored', 1, { type: 'counter', labels: { tier } });
    }
    // C-05 §22 observability: maxsus signal'lar alohida count (tuning)
    if (signals.includes('impossible_travel')) {
      recordMetric('auth.impossible_travel_count', 1, { type: 'counter' });
    }
    if (signals.includes('velocity')) {
      recordMetric('auth.velocity_count', 1, { type: 'counter' });
    }
  } catch (_) {}

  // Device record (touch + risk_events) — faqat hash bo'lsa (privacy: hash'da)
  if (fingerprintHash) {
    try {
      await touchDevice({
        userId,
        fingerprintHash,
        ipAddress,
        userAgent,
        riskEvents: signals.length
          ? [{ signals, at: Date.now(), ipHash: ipHash(ipAddress) }]
          : undefined,
      });
    } catch (_) { /* non-critical */ }
  }
}

/**
 * Mid-session fingerprint mismatch (hijack signal, guide §11):
 * session'da saqlangan fingerprint bilan joriy solishtiriladi.
 * Mismatch → audit + riskFlagged (session) — keyingi qadam user qarori
 * (banner + reauth/logout). FAQAT hash solishtiriladi — raw telemetry yo'q.
 *
 * @returns {Promise<{ mismatch: boolean, flagged: boolean }>}
 */
export async function checkMidSessionFingerprint({ userId, sessionFingerprint, currentFingerprint, ipAddress, userAgent }) {
  if (!sessionFingerprint) return { mismatch: false, flagged: false };
  const mismatch = sessionFingerprint !== currentFingerprint;
  if (mismatch) {
    await logAuthEvent({
      action: 'auth.risk.mismatch',
      outcome: 'flagged',
      method: 'risk',
      actorId: userId,
      ipAddress,
      userAgent,
      details: { reason: 'mid_session_fingerprint_mismatch' },
    }).catch(() => {});
    try {
      recordMetric('auth.risk_mid_session_mismatch', 1, { type: 'counter' });
    } catch (_) {}
  }
  return { mismatch, flagged: mismatch };
}

/** Testlar uchun — faqat time-window'ni o'zgartirish (yozilmaydi). */
export function _riskConfig() {
  return { TRUSTED_MAX, SUSPICIOUS_MIN, TRAVEL_SPEED_KMH, VELOCITY_WINDOW_MS, VELOCITY_DISTINCT_IPS, RISK_EVENTS_MAX };
}
