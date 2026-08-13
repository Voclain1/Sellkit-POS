import { useState, useEffect } from 'react';
import { RefreshCw, CloudOff, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import type { SyncPhase } from '../../lib/offline/sync';

interface Props {
  isOnline: boolean;
  /** Sales still waiting to be pushed (excludes isolated failures). */
  pendingSyncCount: number;
  /** Sales the server rejected outright — they need a manual retry. */
  blockedSyncCount: number;
  syncPhase: SyncPhase;
  lastSyncError: string | null;
  lastSyncedCount: number;
  onRetry: () => void;
}

type Tone = 'info' | 'progress' | 'success' | 'error';

const TONE_STYLES: Record<Tone, string> = {
  info: 'bg-card border-border text-foreground',
  progress: 'bg-card border-brand/40 text-foreground',
  success: 'bg-card border-success/40 text-foreground',
  error: 'bg-card border-danger/40 text-foreground',
};

export function SyncStatusToast({
  isOnline,
  pendingSyncCount,
  blockedSyncCount,
  syncPhase,
  lastSyncError,
  lastSyncedCount,
  onRetry,
}: Props) {
  const [isDismissed, setIsDismissed] = useState(false);
  const hasPending = pendingSyncCount > 0;

  // A new problem (or a new batch to push) re-opens a toast the cashier closed.
  useEffect(() => {
    setIsDismissed(false);
  }, [syncPhase, blockedSyncCount, hasPending]);

  const hasWork = hasPending || blockedSyncCount > 0;
  const isVisible = !isDismissed && (hasWork || syncPhase === 'syncing' || syncPhase === 'success');
  if (!isVisible) return null;

  const plural = (n: number) => (n === 1 ? 'sale' : 'sales');

  let tone: Tone = 'info';
  let icon = <CloudOff className="w-4 h-4 shrink-0" />;
  let title = `${pendingSyncCount} ${plural(pendingSyncCount)} pending sync`;
  let detail = 'Queued locally — they will upload when the connection returns.';

  if (syncPhase === 'syncing') {
    tone = 'progress';
    icon = <RefreshCw className="w-4 h-4 shrink-0 animate-spin text-brand" />;
    title = 'Syncing…';
    detail = `Uploading ${pendingSyncCount} queued ${plural(pendingSyncCount)}.`;
  } else if (blockedSyncCount > 0) {
    tone = 'error';
    icon = <AlertTriangle className="w-4 h-4 shrink-0 text-danger" />;
    title = `Sync error — ${blockedSyncCount} ${plural(blockedSyncCount)} stuck`;
    detail =
      lastSyncError ??
      'The server rejected these sales. They are kept safely on this terminal.';
  } else if (syncPhase === 'success') {
    tone = 'success';
    icon = <CheckCircle2 className="w-4 h-4 shrink-0 text-success" />;
    title = `${lastSyncedCount} ${plural(lastSyncedCount)} synced`;
    detail = 'All offline sales are up to date on the server.';
  } else if (isOnline) {
    tone = 'progress';
    icon = <RefreshCw className="w-4 h-4 shrink-0 text-brand" />;
    detail = 'Waiting for the next sync pass.';
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`no-print fixed bottom-4 left-4 z-[60] w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border shadow-2xl px-4 py-3 text-xs ${TONE_STYLES[tone]}`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5">{icon}</span>

        <div className="flex-1 min-w-0 space-y-1">
          <h4 className="font-extrabold leading-tight">{title}</h4>
          <p className="text-[11px] text-muted leading-snug break-words">{detail}</p>

          {blockedSyncCount > 0 && (
            <button
              type="button"
              onClick={onRetry}
              disabled={!isOnline || syncPhase === 'syncing'}
              className="mt-1.5 px-3 py-1.5 rounded-lg bg-danger/10 border border-danger/30 text-danger font-bold text-[11px] hover:bg-danger/20 disabled:opacity-40 transition"
            >
              Retry sync
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          aria-label="Dismiss sync status"
          className="text-muted hover:text-foreground transition"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
