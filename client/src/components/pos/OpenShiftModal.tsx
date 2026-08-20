import { useState } from 'react';
import { DollarSign, ArrowRight, LogOut } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { TillShift, User } from '../../types/pos';

interface Props {
  isOpen: boolean;
  user: User | null;
  tillId?: string;
  outletName?: string;
  tillName?: string;
  onOpened: (shift: TillShift) => void;
  /** True when hosted inside another modal's card (the PIN flow supplies its own shell). */
  embedded?: boolean;
  /** Offered when the cashier reaches this after closing a shift, rather than at login. */
  onSignOut?: () => void;
}

const QUICK_FLOATS = [50, 100, 200, 500];

/**
 * Opening float entry. Shown at login when the till has no open shift, and again
 * after a Z-report when the cashier starts a fresh drawer without signing out.
 */
export function OpenShiftModal({
  isOpen,
  user,
  tillId,
  outletName,
  tillName,
  onOpened,
  onSignOut,
  embedded = false,
}: Props) {
  const [openingFloat, setOpeningFloat] = useState('100.00');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(openingFloat);
    if (isNaN(val) || val < 0) {
      setError('Enter a valid float amount');
      return;
    }
    if (!tillId) {
      setError('Terminal is not bound to a till yet. Reconnect and try again.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const shift: TillShift = await apiFetch('/shifts/open', {
        method: 'POST',
        body: JSON.stringify({ tillId, openingFloat: val }),
      });
      onOpened(shift);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open shift');
    } finally {
      setLoading(false);
    }
  };

  const body = (
    <form onSubmit={submit}>
      <div className="flex flex-col items-center mb-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-success/10 text-success ring-1 ring-inset ring-success/25 flex items-center justify-center mb-3">
          <DollarSign className="w-6 h-6" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">Open Till Shift</h2>
        <p className="text-sm text-muted mt-1">
          Welcome, <span className="font-semibold text-foreground">{user?.name}</span>
        </p>
        {outletName && tillName && (
          <p className="text-xs text-muted mt-0.5">
            {outletName} — {tillName}
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 text-center text-sm text-danger bg-danger/10 py-2 rounded-lg ring-1 ring-inset ring-danger/25">
          {error}
        </div>
      )}

      <label className="micro-label block mb-2">Opening Float ($)</label>
      <div className="relative mb-3">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-muted num">
          $
        </span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={openingFloat}
          onChange={(e) => setOpeningFloat(e.target.value)}
          className="field num pl-10 pr-4 py-3 text-3xl font-semibold"
          autoFocus
        />
      </div>

      <div className="flex gap-2 mb-6">
        {QUICK_FLOATS.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => setOpeningFloat(amount.toFixed(2))}
            className="btn-quiet num flex-1 py-1.5 rounded-lg text-[11px]"
          >
            ${amount}
          </button>
        ))}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn-success w-full py-3.5 text-sm"
      >
        {loading ? 'Opening…' : 'Start Shift'}
        <ArrowRight className="w-5 h-5" />
      </button>

      {onSignOut && (
        <button
          type="button"
          onClick={onSignOut}
          className="w-full mt-2 py-2 text-[11px] font-semibold text-muted hover:text-danger transition flex items-center justify-center gap-1.5"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign out instead
        </button>
      )}
    </form>
  );

  if (embedded) return body;

  return (
    <div className="modal-overlay no-print">
      <div className="panel w-full max-w-md p-6">
        {body}
      </div>
    </div>
  );
}
