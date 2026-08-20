import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, AlertTriangle, Calculator, WifiOff } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { ShiftSummary, TillShift } from '../../types/pos';

interface Props {
  isOpen: boolean;
  shift: TillShift | null;
  isOnline: boolean;
  /** Queued offline sales the server has not seen yet. */
  pendingSyncCount: number;
  onClose: () => void;
  /** Receives the closed shift's Z-report figures. */
  onClosed: (summary: ShiftSummary) => void;
}

/** Drawer denominations, largest first — the order a cashier counts in. */
const DENOMINATIONS = [100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05, 0.01];

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * End-of-day drawer count. Pulls the shift's live X-report figures, takes the
 * counted cash (by denomination or as a typed total), shows the variance before
 * anything is committed, then closes the shift and hands back the Z-report.
 */
export function CloseShiftModal({
  isOpen,
  shift,
  isOnline,
  pendingSyncCount,
  onClose,
  onClosed,
}: Props) {
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [manualTotal, setManualTotal] = useState('');
  const [useDenominations, setUseDenominations] = useState(true);
  const [notes, setNotes] = useState('');

  const shiftId = shift?.id;

  useEffect(() => {
    if (!isOpen || !shiftId) return;

    let cancelled = false;
    setLoading(true);
    setError('');
    setSummary(null);
    setCounts({});
    setManualTotal('');
    setNotes('');

    apiFetch(`/shifts/${shiftId}/summary`)
      .then((data: ShiftSummary) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? `Could not load shift totals: ${err.message}`
              : 'Could not load shift totals'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, shiftId]);

  const denominationTotal = useMemo(
    () =>
      DENOMINATIONS.reduce((sum, denom) => {
        const qty = parseInt(counts[String(denom)] ?? '', 10);
        return sum + (isNaN(qty) ? 0 : qty * denom);
      }, 0),
    [counts]
  );

  const countedCash = useDenominations ? denominationTotal : parseFloat(manualTotal) || 0;
  const expectedCash = summary?.expectedCash ?? 0;
  const variance = countedCash - expectedCash;
  const hasCount = useDenominations
    ? Object.values(counts).some((v) => v.trim() !== '')
    : manualTotal.trim() !== '';

  if (!isOpen) return null;

  const submit = async () => {
    if (!shiftId) return;
    setSubmitting(true);
    setError('');
    try {
      await apiFetch('/shifts/close', {
        method: 'POST',
        body: JSON.stringify({ shiftId, actualCash: countedCash, notes: notes.trim() || undefined }),
      });
      // Re-read the summary now that it is closed: it comes back bounded by
      // closedAt and carrying the counted cash and variance the server recorded.
      const closed: ShiftSummary = await apiFetch(`/shifts/${shiftId}/summary`);
      onClosed(closed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close shift');
    } finally {
      setSubmitting(false);
    }
  };

  // Closing needs server-side totals, and any sale still sitting in the offline
  // queue is cash the server has not counted yet — reconciling now would report
  // a variance that is purely an artefact of the queue.
  const blocker = !isOnline
    ? 'This terminal is offline. Cash totals come from the server, so a shift cannot be reconciled until the connection is back.'
    : pendingSyncCount > 0
      ? `${pendingSyncCount} offline ${pendingSyncCount === 1 ? 'sale is' : 'sales are'} still waiting to upload. Let them sync first, or the drawer will look short.`
      : '';

  return (
    <div className="modal-overlay no-print">
      <div className="panel w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-warning/10 text-warning ring-1 ring-inset ring-warning/25 flex items-center justify-center">
              <Calculator className="w-3.5 h-3.5" />
            </div>
            <div className="leading-tight">
              <h2 className="font-semibold text-xs">Close Shift — Drawer Count</h2>
              <span className="micro-label">
                {shift ? `Opened ${new Date(shift.openedAt).toLocaleString()}` : ''}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cancel"
            className="btn-quiet p-1.5 hover:text-danger"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {blocker && (
            <div className="flex gap-2 p-3 rounded-xl bg-warning/10 ring-1 ring-inset ring-warning/25 text-warning">
              <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-[11px] font-semibold">{blocker}</p>
            </div>
          )}

          {error && (
            <div className="flex gap-2 p-3 rounded-xl bg-danger/10 ring-1 ring-inset ring-danger/25 text-danger">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-[11px] font-semibold">{error}</p>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-muted">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-xs font-semibold">Loading shift totals…</span>
            </div>
          )}

          {summary && (
            <>
              {/* X-report figures for the open shift */}
              <div className="rounded-xl border border-border bg-surface p-3 space-y-1.5 text-[11px]">
                <div className="flex justify-between text-muted">
                  <span>Sales</span>
                  <span className="num text-foreground">{summary.salesCount}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Gross takings</span>
                  <span className="num text-foreground">{money(summary.grossSales)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Tax collected</span>
                  <span className="num text-foreground">{money(summary.taxTotal)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Opening float</span>
                  <span className="num text-foreground">{money(summary.openingFloat)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Cash sales</span>
                  <span className="num text-foreground">{money(summary.cashSales)}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-border">
                  <span className="font-bold text-foreground">Expected in drawer</span>
                  <span className="num font-semibold text-foreground">
                    {money(summary.expectedCash)}
                  </span>
                </div>
              </div>

              {/* Counting mode */}
              <div className="flex gap-2">
                <button
                  onClick={() => setUseDenominations(true)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                    useDenominations
                      ? 'bg-brand text-brand-foreground border-brand'
                      : 'bg-surface text-muted border-border'
                  }`}
                >
                  Count by denomination
                </button>
                <button
                  onClick={() => setUseDenominations(false)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                    !useDenominations
                      ? 'bg-brand text-brand-foreground border-brand'
                      : 'bg-surface text-muted border-border'
                  }`}
                >
                  Enter total
                </button>
              </div>

              {useDenominations ? (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {DENOMINATIONS.map((denom) => {
                    const key = String(denom);
                    const qty = parseInt(counts[key] ?? '', 10);
                    const line = isNaN(qty) ? 0 : qty * denom;
                    return (
                      <div key={key} className="rounded-lg border border-border bg-surface p-2">
                        <label className="block text-[10px] font-bold text-muted mb-1">
                          {denom >= 1 ? `$${denom}` : `${Math.round(denom * 100)}¢`}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          placeholder="0"
                          value={counts[key] ?? ''}
                          onChange={(e) => setCounts((c) => ({ ...c, [key]: e.target.value }))}
                          className="field num h-7 px-1.5 rounded-md text-[11px] font-semibold"
                        />
                        <span className="block mt-1 text-[9px] num text-muted text-right">
                          {money(line)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-muted num">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={manualTotal}
                    onChange={(e) => setManualTotal(e.target.value)}
                    className="field num pl-8 pr-3 py-2.5 text-xl font-semibold"
                    autoFocus
                  />
                </div>
              )}

              {/* Variance */}
              <div className="rounded-xl border border-border bg-surface p-3 space-y-1.5 text-[11px]">
                <div className="flex justify-between text-muted">
                  <span>Counted</span>
                  <span className="num text-foreground">{money(countedCash)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Expected</span>
                  <span className="num text-foreground">{money(expectedCash)}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-border items-baseline">
                  <span className="font-bold text-foreground">Variance</span>
                  <span
                    className={`num-display text-base ${
                      !hasCount
                        ? 'text-muted'
                        : Math.abs(variance) < 0.01
                          ? 'text-success'
                          : variance > 0
                            ? 'text-warning'
                            : 'text-danger'
                    }`}
                  >
                    {variance >= 0 ? '+' : '−'}
                    {money(Math.abs(variance))}
                  </span>
                </div>
                {hasCount && Math.abs(variance) >= 0.01 && (
                  <p className="text-[10px] text-muted">
                    {variance > 0 ? 'Drawer is over' : 'Drawer is short'} — add a note explaining
                    the difference.
                  </p>
                )}
              </div>

              <div>
                <label className="micro-label block mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Payouts, till transfers, anything explaining a variance"
                  className="field px-2.5 py-2 rounded-lg text-[11px] resize-none"
                />
              </div>
            </>
          )}
        </div>

        <div className="p-3 border-t border-border flex gap-2 shrink-0">
          <button
            onClick={onClose}
            disabled={submitting}
            className="btn-quiet flex-1 py-3 text-xs"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || loading || !summary || !hasCount || Boolean(blocker)}
            title={blocker || (!hasCount ? 'Count the drawer first' : undefined)}
            className="btn flex-[1.4] py-3 text-xs bg-danger text-danger-foreground hover:brightness-110 shadow-[var(--shadow-press),0_10px_24px_-10px_var(--color-danger)]"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Closing…
              </>
            ) : (
              'Close Shift & Print Z-Report'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
