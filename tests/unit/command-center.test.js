/**
 * Edikit — Unit Tests: Exam Command Center, Incident & Notifications (Prompt 41)
 *
 * Pure-logic coverage (Prompt 41 §18 — incident state/authorization + §15
 * security/data guard):
 *   - Incident type/severity validation
 *   - State machine: legal/illegal transitions
 *   - Close guard: owner + action + reason required (§53.7)
 *   - Status cards: room / attendance / incident cards (§53.4)
 *   - Notification preview sanitizer: sensitive detail NEVER leaks (§15)
 *   - Deep-link adapter boundary: channel validation
 *   - Notification batch: idempotency keys deterministic
 *   - Old-schedule invalidation: supersedeOldNotifications
 *   - Postmortem & action-item lifecycle validation
 */

import { describe, it, expect } from 'vitest';
import {
  validateIncident,
  validateIncidentTransition,
  validateIncidentClose,
  buildRoomStatusCard,
  buildAttendanceCard,
  buildIncidentCard,
  buildNotificationPreview,
  buildDeepLinkAdapters,
  buildNotificationBatch,
  supersedeOldNotifications,
  validatePostmortem,
  validatePostmortemTransition,
  validateActionItem,
  validateActionItemTransition,
  INCIDENT_TYPES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUS,
  INCIDENT_STATUS_TRANSITIONS,
  INCIDENT_ACTION_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TEMPLATES,
  NOTIFICATION_STATUS,
  POSTMORTEM_STATUS,
  ACTION_ITEM_STATUS,
} from '../../src/modules/command-center/index.js';

// ═══════════════════════════════════════════════════════════════════
// INCIDENT VALIDATION (§53.4 taxonomy)
// ═══════════════════════════════════════════════════════════════════

describe('Command center — incident validation (§53.4)', () => {
  it('accepts every documented incident type', () => {
    for (const type of INCIDENT_TYPES) {
      const r = validateIncident({ type, severity: 'medium', summary: 'Test incident' });
      expect(r.ok, `type ${type}`).toBe(true);
      expect(r.incident.status).toBe(INCIDENT_STATUS.OPEN);
    }
  });

  it('accepts every severity', () => {
    for (const severity of INCIDENT_SEVERITIES) {
      const r = validateIncident({ type: 'network_power', severity, summary: 'Test incident' });
      expect(r.ok, `severity ${severity}`).toBe(true);
    }
  });

  it('rejects unknown type / severity / empty summary', () => {
    expect(validateIncident({ type: 'alien_attack', severity: 'medium', summary: 'x' }).ok).toBe(false);
    expect(validateIncident({ type: 'medical', severity: 'extreme', summary: 'x' }).ok).toBe(false);
    expect(validateIncident({ type: 'medical', severity: 'low', summary: '  ' }).ok).toBe(false);
    expect(validateIncident({ type: 'medical', severity: 'low', summary: 'ab' }).ok).toBe(false);
  });

  it('sanitizes affected_candidate_ids to positive integers only', () => {
    const r = validateIncident({
      type: 'evacuation', severity: 'high', summary: 'Evacuation drill',
      affected_candidate_ids: [1, '2', -3, 0, 'x', 4.5, 7],
    });
    expect(r.ok).toBe(true);
    expect(r.incident.affected_candidate_ids).toEqual([1, 2, 7]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// STATE MACHINE (§9)
// ═══════════════════════════════════════════════════════════════════

describe('Command center — incident state machine (§9)', () => {
  it('allows documented transitions only', () => {
    for (const [from, tos] of Object.entries(INCIDENT_STATUS_TRANSITIONS)) {
      for (const to of tos) {
        expect(validateIncidentTransition(from, to).ok, `${from} → ${to}`).toBe(true);
      }
    }
  });

  it('rejects illegal transitions', () => {
    expect(validateIncidentTransition('open', 'mitigated').ok).toBe(false);
    expect(validateIncidentTransition('closed', 'open').ok).toBe(false);
    expect(validateIncidentTransition('resolved', 'investigating').ok).toBe(false);
    expect(validateIncidentTransition('mitigated', 'mitigated').ok).toBe(false);
  });

  it('follows the happy path open → investigating → mitigated → resolved → closed', () => {
    let s = INCIDENT_STATUS.OPEN;
    for (const next of [INCIDENT_STATUS.INVESTIGATING, INCIDENT_STATUS.MITIGATED, INCIDENT_STATUS.RESOLVED, INCIDENT_STATUS.CLOSED]) {
      const v = validateIncidentTransition(s, next);
      expect(v.ok).toBe(true);
      s = v.to;
    }
    expect(s).toBe(INCIDENT_STATUS.CLOSED);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CLOSE GUARD (§53.7 — "incident close reason va owner'siz yopilmaydi")
// ═══════════════════════════════════════════════════════════════════

describe('Command center — close guard (§53.7, §10, §24)', () => {
  const baseIncident = {
    id: 1,
    type: 'medical',
    severity: 'high',
    status: 'resolved',
    summary: 'Medical incident',
  };

  it('rejects close without an owner', () => {
    const r = validateIncidentClose(baseIncident, { actionCount: 2, reason: 'handled' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/owner/i);
  });

  it('rejects close without at least one action', () => {
    const r = validateIncidentClose({ ...baseIncident, owner_user_id: 5 }, { actionCount: 0, reason: 'handled' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/action/i);
  });

  it('rejects close without a reason', () => {
    const r = validateIncidentClose({ ...baseIncident, owner_user_id: 5 }, { actionCount: 1, reason: '  ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/reason/i);
  });

  it('accepts close with owner + action + reason', () => {
    const r = validateIncidentClose(
      { ...baseIncident, owner_user_id: 5, actions: [{ action_type: 'remedy' }] },
      { reason: 'resolved and reviewed' },
    );
    expect(r.ok).toBe(true);
  });

  it('accepts close via actionCount when actions array is not loaded', () => {
    const r = validateIncidentClose(
      { ...baseIncident, owner_user_id: 5 },
      { actionCount: 3, reason: 'evacuation complete' },
    );
    expect(r.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// STATUS CARDS (§53.4 command-center dashboard)
// ═══════════════════════════════════════════════════════════════════

describe('Command center — status cards (§53.4)', () => {
  it('builds a ready room card with counters', () => {
    const card = buildRoomStatusCard(
      { id: 1, name: 'B204', building: 'B', capacity: 30, status: 'active' },
      { expected: 25, checkedIn: 24, late: 1, openIncidents: 0 },
    );
    expect(card.ready).toBe(true);
    expect(card.checkedIn).toBe(24);
    expect(card.absent).toBe(0);
    expect(card.roomName).toBe('B204');
  });

  it('flags a room with open incidents as not ready', () => {
    const card = buildRoomStatusCard(
      { id: 2, name: 'C101', status: 'active' },
      { expected: 30, checkedIn: 10, openIncidents: 2 },
    );
    expect(card.ready).toBe(false);
  });

  it('builds attendance card and computes absent + pct', () => {
    const a = buildAttendanceCard({ expected: 100, checkedIn: 87, late: 3 });
    expect(a.absent).toBe(10);
    expect(a.checkedInPct).toBe(87);
  });

  it('incident card never includes raw sensitive fields', () => {
    const card = buildIncidentCard({
      id: 9,
      type: 'medical',
      severity: 'critical',
      status: 'open',
      summary: 'Student needs assistance',
      room_id: 3,
      affected_candidate_ids: [1, 2, 3],
      answer_key: 'SECRET',
      grade: 'A+',
      medical: 'diagnosis details',
    });
    expect(card.summary).toBe('Student needs assistance');
    expect(card.affectedCandidateCount).toBe(3);
    expect(card.answer_key).toBeUndefined();
    expect(card.grade).toBeUndefined();
    expect(card.medical).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION PREVIEW SANITIZER (§15 — security/data guard)
// ═══════════════════════════════════════════════════════════════════

describe('Command center — notification preview sanitizer (§15)', () => {
  it('keeps only whitelisted scalar fields', () => {
    const preview = buildNotificationPreview({
      template_key: 'evacuation',
      channel: 'telegram',
      recipient_scope: 'room',
      room_name: 'B204',
      period_name: '09:00',
      candidate_count: 25,
      // Sensitive — must be dropped:
      health_detail: 'student fainted, bp 90/60',
      integrity_detail: 'answer key leaked',
      answer_key: 'A-B-C-D',
      grade: 'F',
      nested: { secret: true },
    });
    expect(preview.template_key).toBe('evacuation');
    expect(preview.room_name).toBe('B204');
    expect(preview.candidate_count).toBe(25);
    expect(preview.health_detail).toBeUndefined();
    expect(preview.integrity_detail).toBeUndefined();
    expect(preview.answer_key).toBeUndefined();
    expect(preview.grade).toBeUndefined();
    expect(preview.nested).toBeUndefined();
  });

  it('drops non-scalar values even if key is allowlisted', () => {
    const preview = buildNotificationPreview({ room_name: { secret: true }, candidate_count: [1, 2] });
    expect(preview.room_name).toBeUndefined();
    expect(preview.candidate_count).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// DEEP-LINK ADAPTER BOUNDARY (§12)
// ═══════════════════════════════════════════════════════════════════

describe('Command center — deep-link adapter boundary (§12)', () => {
  it('supports email / sms / telegram channels', () => {
    for (const channel of NOTIFICATION_CHANNELS) {
      const r = buildDeepLinkAdapters(channel, { template_key: 'incident_opened', recipient_scope: 'staff' });
      expect(r.ok, channel).toBe(true);
      expect(r.adapter.channel).toBe(channel);
      expect(r.adapter.target).toBeDefined();
    }
  });

  it('rejects unknown channels', () => {
    const r = buildDeepLinkAdapters('carrier_pigeon', {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/channel/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION BATCH + IDEMPOTENCY (§13, §19)
// ═══════════════════════════════════════════════════════════════════

describe('Command center — notification batch idempotency (§13, §19)', () => {
  it('produces deterministic idempotency keys per recipient', () => {
    const keys = ['u1', 'u2', 'u3'];
    const b1 = buildNotificationBatch({
      channel: 'email', recipientScope: 'candidates', templateKey: 'evacuation',
      payload: { room_name: 'B204' }, batchKey: 'evac:run12:roomB204', recipientKeys: keys,
    });
    const b2 = buildNotificationBatch({
      channel: 'email', recipientScope: 'candidates', templateKey: 'evacuation',
      payload: { room_name: 'B204' }, batchKey: 'evac:run12:roomB204', recipientKeys: keys,
    });
    expect(b1.ok).toBe(true);
    expect(b1.entries).toHaveLength(3);
    expect(b1.entries.map((e) => e.idempotency_key)).toEqual(b2.entries.map((e) => e.idempotency_key));
    expect(new Set(b1.entries.map((e) => e.idempotency_key)).size).toBe(3);
  });

  it('sanitizes payload inside batch entries', () => {
    const b = buildNotificationBatch({
      channel: 'sms', recipientScope: 'staff', templateKey: 'incident_updated',
      payload: { room_name: 'C101', health_detail: 'sensitive' }, batchKey: 'inc:9',
    });
    expect(b.ok).toBe(true);
    for (const e of b.entries) {
      expect(e.payload.health_detail).toBeUndefined();
      expect(e.payload.room_name).toBe('C101');
    }
  });

  it('rejects invalid channel / scope / template / missing batchKey', () => {
    expect(buildNotificationBatch({ channel: 'fax', recipientScope: 'staff', templateKey: 'x', batchKey: 'k' }).ok).toBe(false);
    expect(buildNotificationBatch({ channel: 'email', recipientScope: 'everyone', templateKey: 'x', batchKey: 'k' }).ok).toBe(false);
    expect(buildNotificationBatch({ channel: 'email', recipientScope: 'staff', templateKey: 'nope', batchKey: 'k' }).ok).toBe(false);
    expect(buildNotificationBatch({ channel: 'email', recipientScope: 'staff', templateKey: 'test' }).ok).toBe(false);
  });

  it('supersedes old pending notifications for same template (old schedule invalidation)', () => {
    const existing = [
      { id: 1, status: NOTIFICATION_STATUS.PENDING, template_key: 'schedule_change', idempotency_key: 'old:1' },
      { id: 2, status: NOTIFICATION_STATUS.PENDING, template_key: 'schedule_change', idempotency_key: 'new:1' },
      { id: 3, status: NOTIFICATION_STATUS.DELIVERED, template_key: 'schedule_change', idempotency_key: 'delivered:1' },
      { id: 4, status: NOTIFICATION_STATUS.PENDING, template_key: 'evacuation', idempotency_key: 'evac:1' },
    ];
    const superseded = supersedeOldNotifications(existing, { templateKey: 'schedule_change', batchKey: 'new' });
    expect(superseded).toEqual([1]); // id 3 delivered → kept; id 2 same batch → kept; id 4 different template → kept
  });
});

// ═══════════════════════════════════════════════════════════════════
// POSTMORTEM & ACTION ITEMS (§14)
// ═══════════════════════════════════════════════════════════════════

describe('Command center — postmortem & action items (§14)', () => {
  it('validates postmortem create and lifecycle', () => {
    const v = validatePostmortem({ incident_id: 9, summary: 'Network outage', root_cause: 'UPS failure' });
    expect(v.ok).toBe(true);
    expect(v.postmortem.status).toBe(POSTMORTEM_STATUS.DRAFT);
    expect(validatePostmortemTransition('draft', 'reviewed').ok).toBe(true);
    expect(validatePostmortemTransition('reviewed', 'closed').ok).toBe(true);
    expect(validatePostmortemTransition('draft', 'open').ok).toBe(false);
    expect(validatePostmortemTransition('closed', 'draft').ok).toBe(false);
  });

  it('validates action-item create and lifecycle', () => {
    const v = validateActionItem({ postmortem_id: 1, description: 'Replace UPS battery', owner_user_id: 3 });
    expect(v.ok).toBe(true);
    expect(v.item.status).toBe(ACTION_ITEM_STATUS.OPEN);
    expect(validateActionItemTransition('open', 'in_progress').ok).toBe(true);
    expect(validateActionItemTransition('in_progress', 'done').ok).toBe(true);
    expect(validateActionItemTransition('done', 'open').ok).toBe(false);
    expect(validateActionItemTransition('open', 'done').ok).toBe(true);
  });

  it('requires incident_id and description', () => {
    expect(validatePostmortem({ summary: 'x' }).ok).toBe(false);
    expect(validateActionItem({ postmortem_id: 1, description: '  ' }).ok).toBe(false);
  });
});
