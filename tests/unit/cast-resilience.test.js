/**
 * Deborah — Hybrid va low-bandwidth mode (C4-02) Tests
 * ----------------------------------------------------
 * coverage: resolveParticipantDelivery (in_room/remote/hybrid), bucketNetworkQuality
 * (latency/loss thresholds — item 8), deliveryFingerprint stability (item 15),
 * classifyStatus (technical_failure vs no_response alohida — item 9; remote network
 * issue wrong answer EMAS), splitCoverageByDelivery (item 14), lowBandwidthPolicy
 * (item 10/11), evidence-service integration (deliverySplit + technicalFailure
 * counters), config cross-field (hybrid question-on-device blocker).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveParticipantDelivery,
  bucketNetworkQuality,
  deliveryFingerprint,
  classifyStatus,
  splitCoverageByDelivery,
  lowBandwidthPolicy,
  NETWORK_BUCKETS,
  DELIVERY_TYPES,
} from '../../services/cast/resilience-service.js';
import { computeQuestionEvidence } from '../../services/cast/evidence-service.js';
import { validateCrossField } from '../../services/cast/config-schema.js';

const IN_ROOM = { participation: { delivery: 'in_room' } };
const REMOTE = { participation: { delivery: 'remote' } };
const HYBRID = { participation: { delivery: 'hybrid' } };

describe('C4-02: Hybrid va low-bandwidth', () => {
  describe('delivery resolution (item 1/2)', () => {
    it('in_room config → in_room regardless of declared', () => {
      expect(resolveParticipantDelivery(IN_ROOM, 'remote')).toBe(DELIVERY_TYPES.IN_ROOM);
      expect(resolveParticipantDelivery(IN_ROOM, 'in_room')).toBe(DELIVERY_TYPES.IN_ROOM);
    });

    it('remote config → remote regardless of declared', () => {
      expect(resolveParticipantDelivery(REMOTE, 'in_room')).toBe(DELIVERY_TYPES.REMOTE);
    });

    it('hybrid config → declared remote is remote, else in_room', () => {
      expect(resolveParticipantDelivery(HYBRID, 'remote')).toBe(DELIVERY_TYPES.REMOTE);
      expect(resolveParticipantDelivery(HYBRID, 'in_room')).toBe(DELIVERY_TYPES.IN_ROOM);
      expect(resolveParticipantDelivery(HYBRID, undefined)).toBe(DELIVERY_TYPES.IN_ROOM);
    });
  });

  describe('network quality buckets (item 8)', () => {
    it('good under 300ms latency', () => {
      expect(bucketNetworkQuality({ latencyMs: 150, lossPercent: 0, sampleCount: 4 })).toBe(NETWORK_BUCKETS.GOOD);
    });

    it('degraded at 300–800ms', () => {
      expect(bucketNetworkQuality({ latencyMs: 400, lossPercent: 0, sampleCount: 4 })).toBe(NETWORK_BUCKETS.DEGRADED);
      expect(bucketNetworkQuality({ latencyMs: 799, lossPercent: 0, sampleCount: 4 })).toBe(NETWORK_BUCKETS.DEGRADED);
    });

    it('poor over 800ms or >=20% loss', () => {
      expect(bucketNetworkQuality({ latencyMs: 900, lossPercent: 0, sampleCount: 4 })).toBe(NETWORK_BUCKETS.POOR);
      expect(bucketNetworkQuality({ latencyMs: 100, lossPercent: 25, sampleCount: 4 })).toBe(NETWORK_BUCKETS.POOR);
    });

    it('degraded at >=5% loss', () => {
      expect(bucketNetworkQuality({ latencyMs: 100, lossPercent: 8, sampleCount: 4 })).toBe(NETWORK_BUCKETS.DEGRADED);
    });

    it('no samples → unknown', () => {
      expect(bucketNetworkQuality({ latencyMs: 0, lossPercent: 0, sampleCount: 0 })).toBe('unknown');
    });
  });

  describe('delivery fingerprint (item 15)', () => {
    it('stable for same config', () => {
      const cfg = {
        participation: { delivery: 'hybrid', paperCardMode: false },
        resilience: { reconnectGraceMs: 120000, networkTelemetry: true, lowBandwidth: { enabled: false } },
      };
      expect(deliveryFingerprint(cfg)).toBe(deliveryFingerprint(cfg));
    });

    it('changes when delivery mode changes', () => {
      const a = deliveryFingerprint({ participation: { delivery: 'in_room' } });
      const b = deliveryFingerprint({ participation: { delivery: 'remote' } });
      expect(a).not.toBe(b);
    });

    it('changes when low-bandwidth toggled', () => {
      const base = { participation: { delivery: 'remote' }, resilience: { lowBandwidth: { enabled: false } } };
      const lbw = { participation: { delivery: 'remote' }, resilience: { lowBandwidth: { enabled: true } } };
      expect(deliveryFingerprint(base)).not.toBe(deliveryFingerprint(lbw));
    });
  });

  describe('technical failure vs no-response (item 9)', () => {
    it('remote + degraded network + no answer → technical_failure', () => {
      const status = classifyStatus({
        participant: { delivery: 'remote', networkBucket: 'degraded', presence: 'online' },
        hasAnswer: false,
      });
      expect(status).toBe('technical_failure');
    });

    it('remote + poor network + no answer → technical_failure', () => {
      const status = classifyStatus({
        participant: { delivery: 'remote', networkBucket: 'poor', presence: 'online' },
        hasAnswer: false,
      });
      expect(status).toBe('technical_failure');
    });

    it('remote + good network + no answer → no_response (NOT wrong answer)', () => {
      const status = classifyStatus({
        participant: { delivery: 'remote', networkBucket: 'good', presence: 'online' },
        hasAnswer: false,
      });
      expect(status).toBe('no_response');
    });

    it('in_room + degraded + no answer → no_response', () => {
      const status = classifyStatus({
        participant: { delivery: 'in_room', networkBucket: 'degraded', presence: 'online' },
        hasAnswer: false,
      });
      expect(status).toBe('no_response');
    });

    it('offline → disconnected; late → late_join; answered → accepted', () => {
      expect(classifyStatus({ participant: { presence: 'offline' }, hasAnswer: false })).toBe('disconnected');
      expect(classifyStatus({ participant: { late: true, presence: 'online' }, hasAnswer: false })).toBe('late_join');
      expect(classifyStatus({ participant: { presence: 'online' }, hasAnswer: true })).toBe('accepted');
    });
  });

  describe('in_room/remote coverage split (item 14)', () => {
    it('splits answered/total/active by delivery', () => {
      const participants = {
        p1: { delivery: 'in_room', presence: 'online' },
        p2: { delivery: 'in_room', presence: 'offline' },
        p3: { delivery: 'remote', presence: 'online' },
        p4: { delivery: 'remote', presence: 'online' },
      };
      const answers = { p1: { isCorrect: true }, p3: { isCorrect: false } };
      const split = splitCoverageByDelivery(participants, answers);
      expect(split.inRoom).toMatchObject({ total: 2, active: 1, answered: 1, responseRate: 50 });
      expect(split.remote).toMatchObject({ total: 2, active: 2, answered: 1, responseRate: 50 });
      expect(split.coverage.inRoom).toBe(50);
      expect(split.coverage.remote).toBe(100);
    });

    it('empty participants → zero split', () => {
      const split = splitCoverageByDelivery({}, {});
      expect(split.inRoom.total).toBe(0);
      expect(split.remote.total).toBe(0);
      expect(split.coverage.inRoom).toBe(0);
    });
  });

  describe('low-bandwidth policy (item 10/11)', () => {
    it('defaults decorative off + maxMediaKb', () => {
      const p = lowBandwidthPolicy({});
      expect(p.enabled).toBe(false);
      expect(p.decorativeEventsOff).toBe(true);
      expect(p.maxMediaKb).toBe(120);
    });

    it('enabled config respected', () => {
      const p = lowBandwidthPolicy({ resilience: { lowBandwidth: { enabled: true, maxMediaKb: 60 } } });
      expect(p.enabled).toBe(true);
      expect(p.maxMediaKb).toBe(60);
    });
  });

  describe('evidence-service integration', () => {
    it('technical failure counted separately from no_response + deliverySplit present', () => {
      const evidence = computeQuestionEvidence({
        sessionId: 's1',
        questionId: 'q1',
        participants: {
          p1: { delivery: 'in_room', presence: 'online' },               // no answer → no_response
          p2: { delivery: 'remote', presence: 'online', networkBucket: 'poor' }, // no answer → technical_failure
          p3: { delivery: 'remote', presence: 'online', networkBucket: 'good' }, // no answer → no_response
          p4: { delivery: 'remote', presence: 'online' },                // answered
        },
        answers: { p4: { isCorrect: true, confidence: 'high', elapsedMs: 500, selectedOptionIds: ['a'] } },
        revision: 1,
      });
      expect(evidence.technicalFailure).toBe(1);
      expect(evidence.noResponse).toBe(2);
      expect(evidence.disconnected).toBe(0);
      expect(evidence.accepted).toBe(1);
      expect(evidence.deliverySplit).toBeDefined();
      expect(evidence.deliverySplit.inRoom.total).toBe(1);
      expect(evidence.deliverySplit.remote.total).toBe(3);
      // Remote network issue → wrong answer EMAS (faqat texnik uzilish sifatida)
      expect(evidence.incorrect).toBe(0);
    });
  });

  describe('config cross-field (item 3/4/5)', () => {
    const cfg = (delivery, showQ) => ({
      timer: { mode: 'soft' },
      playback: { advanceMode: 'manual', closeTrigger: ['host_or_soft_timeout'] },
      join: { identity: 'safe_alias' },
      leaderboard: { visibility: 'top_n' },
      scoring: { mode: 'accuracy', speedBonusMax: 0 },
      participation: { delivery },
      accessibility: { showQuestionOnDevice: showQ },
      teams: { enabled: false },
    });

    it('hybrid + showQuestionOnDevice=false → blocker (item 3)', () => {
      const { errors } = validateCrossField(cfg('hybrid', false));
      expect(errors.some((e) => e.code === 'CROSS_FIELD_BLOCKER' && e.path === 'participation.delivery')).toBe(true);
    });

    it('hybrid + question on device → no blocker', () => {
      const { errors } = validateCrossField(cfg('hybrid', true));
      expect(errors.some((e) => e.code === 'CROSS_FIELD_BLOCKER' && e.path === 'participation.delivery')).toBe(false);
    });
  });
});
