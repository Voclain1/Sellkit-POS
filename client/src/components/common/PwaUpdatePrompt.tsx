import { useSyncExternalStore, useState } from 'react';
import { DownloadCloud, HardDriveDownload, X } from 'lucide-react';
import {
  subscribeToPwaState,
  isUpdateReady,
  isOfflineReady,
  acknowledgeOfflineReady,
  applyUpdate,
} from '../../lib/pwa';

interface Props {
  /** Reloading with queued work in the cart would lose it, so we warn instead. */
  hasUnfinishedWork: boolean;
}

/**
 * Offers a new app version, but never takes it: the cashier decides when the
 * terminal reloads. Also confirms the first time the shell is cached offline.
 */
export function PwaUpdatePrompt({ hasUnfinishedWork }: Props) {
  const updateReady = useSyncExternalStore(subscribeToPwaState, isUpdateReady);
  const offlineReady = useSyncExternalStore(subscribeToPwaState, isOfflineReady);
  const [isUpdating, setIsUpdating] = useState(false);

  if (!updateReady && !offlineReady) return null;

  const handleUpdate = async () => {
    setIsUpdating(true);
    await applyUpdate();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print panel fixed bottom-4 right-4 z-[60] w-[19rem] max-w-[calc(100vw-2rem)] border-brand/30 px-4 py-3 text-xs"
    >
      {updateReady ? (
        <div className="flex items-start gap-2.5">
          <DownloadCloud className="w-4 h-4 shrink-0 mt-0.5 text-brand" />
          <div className="flex-1 min-w-0 space-y-1">
            <h4 className="font-semibold leading-tight">Update available</h4>
            <p className="text-[11px] text-muted leading-snug">
              {hasUnfinishedWork
                ? 'Finish or clear the current sale first — updating reloads the terminal.'
                : 'A new version of Sellkit POS is ready to install.'}
            </p>
            <button
              type="button"
              onClick={handleUpdate}
              disabled={isUpdating || hasUnfinishedWork}
              className="btn-primary mt-1.5 px-3 py-1.5 rounded-lg text-[11px]"
            >
              {isUpdating ? 'Reloading…' : 'Reload & update'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5">
          <HardDriveDownload className="w-4 h-4 shrink-0 mt-0.5 text-success" />
          <div className="flex-1 min-w-0 space-y-1">
            <h4 className="font-semibold leading-tight">Ready to work offline</h4>
            <p className="text-[11px] text-muted leading-snug">
              This terminal is cached and will keep selling without a connection.
            </p>
          </div>
          <button
            type="button"
            onClick={acknowledgeOfflineReady}
            aria-label="Dismiss"
            className="text-muted hover:text-foreground transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
