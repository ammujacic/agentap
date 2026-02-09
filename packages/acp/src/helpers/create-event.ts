import type { ACPEvent } from '../envelope';

let seqCounters = new Map<string, number>();

/**
 * Create an ACP event with auto-incremented sequence number and timestamp.
 * Pass the event-specific fields (including `type`) and the base fields are auto-filled.
 */
export function createEvent(
  sessionId: string,
  event: Record<string, unknown> & { type: string }
): ACPEvent {
  const seq = (seqCounters.get(sessionId) ?? 0) + 1;
  seqCounters.set(sessionId, seq);

  return {
    seq,
    sessionId,
    timestamp: new Date().toISOString(),
    ...event,
  } as ACPEvent;
}

/**
 * Reset sequence counter for a session (e.g. on session start).
 */
export function resetSequence(sessionId: string): void {
  seqCounters.delete(sessionId);
}

/**
 * Reset all sequence counters (e.g. for testing).
 */
export function resetAllSequences(): void {
  seqCounters = new Map();
}
