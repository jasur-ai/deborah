/**
 * Deborah — Board service integration tests (Prompt 47)
 *
 * Service-layer coverage (graceful degradation without PostgreSQL):
 *   - Write paths validate input BEFORE requiring PG (fail fast with
 *     clear errors).
 *   - Read paths return []/null when PG is unavailable.
 *   - Validation contract: required fields, invalid roles/votes rejected.
 */

import { describe, it, expect } from 'vitest';
import {
  assignBoardRole,
  createBoardMeeting,
  openBoardMeeting,
  addAttendee,
  recordVote,
  getBoardReadiness,
  ratifyResult,
  releaseBatch,
  appendAmendment,
  reconcileOutbox,
  getBoardMeeting,
  listBoardMeetings,
  listAttendees,
  listDecisions,
  listAmendments,
  listOutbox,
} from '../../src/modules/board/index.js';

describe('board service — validation contract (pre-DB)', () => {
  it('assignBoardRole requires a valid role', async () => {
    await expect(assignBoardRole({ userId: 1, role: 'janitor' })).rejects.toThrow('valid board role');
    await expect(assignBoardRole({ userId: 1, role: 'member' })).rejects.toThrow('PostgreSQL required');
  });

  it('createBoardMeeting requires a title', async () => {
    await expect(createBoardMeeting({ title: '' })).rejects.toThrow('title is required');
  });

  it('openBoardMeeting requires meetingId', async () => {
    await expect(openBoardMeeting({})).rejects.toThrow('meetingId is required');
  });

  it('addAttendee requires meetingId and userId', async () => {
    await expect(addAttendee({})).rejects.toThrow('meetingId and userId are required');
  });

  it('recordVote rejects invalid votes', async () => {
    await expect(recordVote({ meetingId: 1, userId: 2, vote: 'maybe' })).rejects.toThrow('Invalid vote');
  });

  it('ratifyResult requires meetingId, runId and userId', async () => {
    await expect(ratifyResult({})).rejects.toThrow('meetingId, runId and userId are required');
  });

  it('releaseBatch requires PostgreSQL (no idempotent stub)', async () => {
    await expect(releaseBatch({ decisionId: 1 })).rejects.toThrow('PostgreSQL required');
  });

  it('appendAmendment requires runId and newFinal', async () => {
    await expect(appendAmendment({})).rejects.toThrow('runId and newFinal are required');
  });

  it('reconcileOutbox requires outboxId or externalKey', async () => {
    await expect(reconcileOutbox({})).rejects.toThrow('outboxId or externalKey is required');
  });
});

describe('board service — graceful degradation (read paths)', () => {
  it('listBoardMeetings resolves to [] without PG', async () => {
    expect(await listBoardMeetings({})).toEqual([]);
  });

  it('listAttendees resolves to [] without PG', async () => {
    expect(await listAttendees({})).toEqual([]);
  });

  it('listDecisions resolves to [] without PG', async () => {
    expect(await listDecisions({})).toEqual([]);
  });

  it('listAmendments resolves to [] without PG', async () => {
    expect(await listAmendments({})).toEqual([]);
  });

  it('listOutbox resolves to [] without PG', async () => {
    expect(await listOutbox({})).toEqual([]);
  });

  it('getBoardMeeting resolves to null without PG', async () => {
    expect(await getBoardMeeting(1)).toBeNull();
  });

  it('getBoardReadiness reports PostgreSQL blocker without PG', async () => {
    const r = await getBoardReadiness({ runId: 1 });
    expect(r.ok).toBe(false);
    expect(r.blockers).toContain('PostgreSQL required');
  });
});
