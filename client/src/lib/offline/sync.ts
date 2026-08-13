import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, ApiError } from '../api';
import {
  getQueuedSales,
  removeQueuedSale,
  recordSyncFailure,
  requeueFailedSales,
} from './db';

/**
 * `success` is transient — the hook drops back to `idle` a few seconds after a
 * sync that actually pushed something, so the UI can flash a confirmation.
 */
export type SyncPhase = 'idle' | 'syncing' | 'success' | 'error';

export interface SyncFailure {
  id: string;
  message: string;
  /** True when the server will reject this payload every time (4xx). */
  permanent: boolean;
}

export interface SyncSummary {
  synced: number;
  /** Attempted and failed on this pass. */
  failed: number;
  /** Skipped because a previous pass isolated them as permanently rejected. */
  blocked: number;
  failures: SyncFailure[];
}

const SUCCESS_TOAST_MS = 4000;
const QUEUE_POLL_MS = 5000;
/** Periodic retry, so a queue left over from a missed `online` event still drains. */
const RETRY_SWEEP_MS = 60000;

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [blockedSyncCount, setBlockedSyncCount] = useState(0);
  const [syncPhase, setSyncPhase] = useState<SyncPhase>('idle');
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [lastSyncedCount, setLastSyncedCount] = useState(0);

  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshQueue = useCallback(async () => {
    const queue = await getQueuedSales();
    setPendingSyncCount(queue.filter((i) => i.status !== 'failed').length);

    const blocked = queue.filter((i) => i.status === 'failed');
    setBlockedSyncCount(blocked.length);

    // Keep a stuck sale visible even across reloads, when no sync has run yet.
    if (blocked.length > 0) {
      setLastSyncError((prev) => prev ?? blocked[0].lastError ?? 'Sale rejected by server');
      setSyncPhase((prev) => (prev === 'syncing' ? prev : 'error'));
    }
  }, []);

  const runSync = useCallback(async (): Promise<SyncSummary | null> => {
    if (!navigator.onLine) return null;

    const queue = await getQueuedSales();
    if (queue.every((i) => i.status === 'failed')) {
      // Nothing syncable; still refresh so the blocked badge is accurate.
      await refreshQueue();
      return null;
    }

    if (successTimer.current) clearTimeout(successTimer.current);
    setSyncPhase('syncing');

    const summary = await syncAll();
    await refreshQueue();

    setLastSyncedCount(summary.synced);

    if (summary.failures.length > 0) {
      setLastSyncError(summary.failures[0].message);
      setSyncPhase('error');
    } else if (summary.blocked > 0) {
      setSyncPhase('error');
    } else if (summary.synced > 0) {
      setLastSyncError(null);
      setSyncPhase('success');
      successTimer.current = setTimeout(() => setSyncPhase('idle'), SUCCESS_TOAST_MS);
    } else {
      setLastSyncError(null);
      setSyncPhase('idle');
    }

    return summary;
  }, [refreshQueue]);

  /** Manual "Retry" — put isolated sales back in the queue and sync again. */
  const retryFailedSync = useCallback(async () => {
    await requeueFailedSales();
    setLastSyncError(null);
    setSyncPhase('idle');
    await runSync();
  }, [runSync]);

  useEffect(() => {
    refreshQueue();
    // Drain anything left over from a previous session before the first sale.
    if (navigator.onLine) runSync();

    const goOnline = () => {
      setIsOnline(true);
      runSync();
    };
    const goOffline = () => {
      setIsOnline(false);
      setSyncPhase((prev) => (prev === 'syncing' ? 'idle' : prev));
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const pollIv = setInterval(refreshQueue, QUEUE_POLL_MS);
    const sweepIv = setInterval(() => {
      if (navigator.onLine) runSync();
    }, RETRY_SWEEP_MS);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(pollIv);
      clearInterval(sweepIv);
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, [refreshQueue, runSync]);

  return {
    isOnline,
    pendingSyncCount,
    blockedSyncCount,
    syncPhase,
    lastSyncError,
    lastSyncedCount,
    refreshQueue,
    syncNow: runSync,
    retryFailedSync,
  };
}

let inFlight: Promise<SyncSummary> | null = null;

/**
 * Push every queued offline sale. Single-flight: the reconnect handler, the
 * retry sweep and a manual retry can all land at once, and replaying the same
 * sale twice would double-count it at the till.
 */
export function syncAll(): Promise<SyncSummary> {
  if (!inFlight) {
    inFlight = drainQueue().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function drainQueue(): Promise<SyncSummary> {
  const empty: SyncSummary = { synced: 0, failed: 0, blocked: 0, failures: [] };
  if (!navigator.onLine) return empty;

  const queue = await getQueuedSales();
  const summary: SyncSummary = { ...empty, failures: [] };

  for (const item of queue) {
    // Already isolated by an earlier pass — skip it rather than retrying a
    // payload the server has definitively rejected. It stays in the queue.
    if (item.status === 'failed') {
      summary.blocked += 1;
      continue;
    }

    try {
      await apiFetch('/sales/checkout', {
        method: 'POST',
        body: JSON.stringify(item.payload),
      });
      await removeQueuedSale(item.id);
      summary.synced += 1;
    } catch (err) {
      summary.failed += 1;

      // A 4xx means the server will reject this payload every time (stock gone,
      // stale variant id, bad till). Retrying it forever would wedge the queue
      // behind it, so isolate it and make the reason visible rather than
      // silently looping. Deleting it would destroy a real sale, so we never do.
      const permanent = err instanceof ApiError && !err.isRetryable;
      const status = err instanceof ApiError ? err.status : 0;
      const reason = err instanceof Error ? err.message : String(err);

      const message = permanent
        ? `Sale ${item.id} rejected (HTTP ${status}): ${reason}`
        : `Sale ${item.id} could not reach the server: ${reason}`;

      await recordSyncFailure(item.id, message, permanent);
      summary.failures.push({ id: item.id, message, permanent });

      if (permanent) {
        console.error(`${message} — needs manual review; it will not sync on its own.`);
      } else {
        console.warn(`Sync deferred for ${item.id}:`, err);
      }

      // Either way, keep going: one bad sale must not hold up the rest.
      continue;
    }
  }

  return summary;
}
