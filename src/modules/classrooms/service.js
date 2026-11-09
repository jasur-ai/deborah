import crypto from 'crypto';
import { safeKey } from '../../../utils/helpers.js';

export const CLASSROOM_QR_TTL_MS = 45_000;
export const CLASSROOM_QR_ROTATE_MS = 15_000;
export const CLASSROOM_JOIN_TICKET_TTL_MS = 90_000;
export const CLASSROOM_DEFAULT_RADIUS_METERS = 300;
export const CLASSROOM_MAX_GEO_ACCURACY_METERS = 250;

export const DEFAULT_GRADE_POLICY = Object.freeze({
  weights: Object.freeze({ accuracy: 80, speed: 20 }),
  thresholds: Object.freeze([
    Object.freeze({ minPercent: 88, grade: 1.5 }),
    Object.freeze({ minPercent: 75, grade: 1.0 }),
    Object.freeze({ minPercent: 60, grade: 0.5 }),
  ]),
  below: 0,
});

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function normalizeGroupName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function classroomGroupId(value) {
  const normalized = normalizeGroupName(value);
  const id = safeKey(normalized);
  if (!normalized || normalized.length > 80 || !/^[a-z0-9_-]{1,60}$/.test(id)) return null;
  return id;
}

export function normalizeHemisId(value) {
  const raw = String(value || '').normalize('NFKC').trim();
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(raw)) return null;
  return raw.toUpperCase();
}

export function normalizePersonName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classroomUserKey(value) {
  const key = safeKey(String(value || '').normalize('NFKC').trim());
  return /^[a-z0-9_-]{2,60}$/.test(key) ? key : null;
}

export function validateClassroomLocation(input = {}) {
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const radiusMeters = Number(input.radiusMeters ?? CLASSROOM_DEFAULT_RADIUS_METERS);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return { ok: false, error: 'Kenglik qiymati noto‘g‘ri' };
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return { ok: false, error: 'Uzunlik qiymati noto‘g‘ri' };
  if (!Number.isFinite(radiusMeters) || radiusMeters < 50 || radiusMeters > 3000) return { ok: false, error: 'Radius 50–3000 metr oralig‘ida bo‘lishi kerak' };
  // Dars nuqtasi — faqat tekshiruv uchun saqlanadi; talaba koordinatalari qayd etilmaydi.
  return { ok: true, geofence: { latitude, longitude, radiusMeters: Math.round(radiusMeters) } };
}

export function validateGradePolicy(input = {}) {
  const accuracy = Number(input.weights?.accuracy ?? DEFAULT_GRADE_POLICY.weights.accuracy);
  const speed = Number(input.weights?.speed ?? DEFAULT_GRADE_POLICY.weights.speed);
  if (!Number.isInteger(accuracy) || !Number.isInteger(speed) || accuracy < 0 || speed < 0 || accuracy + speed !== 100) {
    return { ok: false, error: 'Aniqlik va tezlik ulushlari butun foiz bo‘lib, yig‘indisi 100 bo‘lishi kerak' };
  }

  const rawThresholds = Array.isArray(input.thresholds) ? input.thresholds : DEFAULT_GRADE_POLICY.thresholds;
  if (rawThresholds.length !== 3) return { ok: false, error: 'Uchta baho chegarasi kiritilishi kerak' };
  const thresholds = rawThresholds.map((row, index) => ({
    minPercent: Number(row?.minPercent ?? DEFAULT_GRADE_POLICY.thresholds[index].minPercent),
    grade: Number(row?.grade ?? DEFAULT_GRADE_POLICY.thresholds[index].grade),
  }));
  const descending = thresholds.every((row, i) => i === 0 || row.minPercent < thresholds[i - 1].minPercent);
  const gradesDescending = thresholds.every((row, i) => i === 0 || row.grade <= thresholds[i - 1].grade);
  if (!thresholds.every((row) => Number.isInteger(row.minPercent) && row.minPercent >= 1 && row.minPercent <= 100
    && Number.isFinite(row.grade) && row.grade >= 0 && row.grade <= 10)
    || !descending || !gradesDescending) {
    return { ok: false, error: 'Chegaralar 1–100 oralig‘ida kamayib borishi, baholar esa kamaymasligi kerak' };
  }
  const below = Number(input.below ?? DEFAULT_GRADE_POLICY.below);
  if (!Number.isFinite(below) || below < 0 || below > 10 || below > thresholds[2].grade) {
    return { ok: false, error: 'Eng past baho 0–10 oralig‘ida va oxirgi chegaradan yuqori bo‘lmasligi kerak' };
  }
  return {
    ok: true,
    policy: { weights: { accuracy, speed }, thresholds, below },
  };
}

export function calculateClassroomGrade({ answers = [], questionCount = 0, policy = DEFAULT_GRADE_POLICY } = {}) {
  const total = Math.max(0, Number(questionCount) || 0);
  const attempted = answers.length;
  const correct = answers.reduce((sum, answer) => sum + (answer?.isCorrect === true ? 1 : 0), 0);
  const totalPoints = answers.reduce((sum, answer) => {
    const score = Number(answer?.score);
    return sum + (Number.isFinite(score) && score > 0 ? score : 0);
  }, 0);
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((totalPoints / (total * 100)) * 10000) / 100)) : null;
  const normalizedPolicy = policy || DEFAULT_GRADE_POLICY;
  let grade = null;
  if (percent !== null) {
    grade = normalizedPolicy.thresholds.find((row) => percent >= row.minPercent)?.grade ?? normalizedPolicy.below;
  }
  return {
    attempted,
    correct,
    questionCount: total,
    accuracyPercent: total > 0 ? Math.round((correct / total) * 10000) / 100 : null,
    scorePercent: percent,
    grade,
  };
}

export function distanceMeters(a, b) {
  const radians = (value) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function classroomDisplayName(student = {}) {
  return [normalizePersonName(student.firstName), normalizePersonName(student.lastName)].filter(Boolean).join(' ');
}
