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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 no-print">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-card-foreground">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <Calculator className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="font-bold text-xs">Close Shift — Drawer Count</h2>
              <span className="text-[10px] text-muted">
                {shift ? `Opened ${new Date(shift.openedAt).toLocaleString()}` : ''}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cancel"
            className="p-1.5 rounded-lg bg-surface border border-border text-muted hover:text-danger transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {blocker && (
            <div className="flex gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400">
              <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-[11px] font-semibold">{blocker}</p>
            </div>
          )}

          {error && (
            <div className="flex gap-2 p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger">
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
                  <span className="font-mono text-foreground">{summary.salesCount}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Gross takings</span>
                  <span className="font-mono text-foreground">{money(summary.grossSales)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Tax collected</span>
                  <span className="font-mono text-foreground">{money(summary.taxTotal)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Opening float</span>
                  <span className="font-mono text-foreground">{money(summary.openingFloat)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Cash sales</span>
                  <span className="font-mono text-foreground">{money(summary.cashSales)}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-border">
                  <span className="font-bold text-foreground">Expected in drawer</span>
                  <span className="font-mono font-bold text-foreground">
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
                          className="w-full h-7 px-1.5 rounded-md border border-border bg-card text-[11px] font-mono font-bold focus:outline-none focus:ring-1 focus:ring-brand"
                        />
                        <span className="block mt-1 text-[9px] font-mono text-muted text-right">
                          {money(line)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-muted font-mono">
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
                    className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-border bg-surface text-xl font-bold font-mono focus:outline-none focus:ring-2 focus:ring-brand"
                    autoFocus
                  />
                </div>
              )}

              {/* Variance */}
              <div className="rounded-xl border border-border bg-surface p-3 space-y-1.5 text-[11px]">
                <div className="flex justify-between text-muted">
                  <span>Counted</span>
                  <span className="font-mono text-foreground">{money(countedCash)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Expected</span>
                  <span className="font-mono text-foreground">{money(expectedCash)}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-border items-baseline">
                  <span className="font-bold text-foreground">Variance</span>
                  <span
                    className={`font-mono font-black text-base ${
                      !hasCount
                        ? 'text-muted'
                        : Math.abs(variance) < 0.01
                          ? 'text-success'
                          : variance > 0
                            ? 'text-amber-500'
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
                <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Payouts, till transfers, anything explaining a variance"
                  className="w-full px-2.5 py-2 rounded-lg border border-border bg-surface text-[11px] resize-none focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
            </>
          )}
        </div>

        <div className="p-3 border-t border-border flex gap-2 shrink-0">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-3 rounded-xl bg-surface border border-border text-muted font-bold text-xs hover:text-foreground transition disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || loading || !summary || !hasCount || Boolean(blocker)}
            title={blocker || (!hasCount ? 'Count the drawer first' : undefined)}
            className="flex-[1.4] py-3 rounded-xl bg-danger text-danger-foreground font-black text-xs shadow-lg shadow-danger/20 transition hover:brightness-110 disabled:opacity-30 flex items-center justify-center gap-1.5"
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
