import { Printer, ClipboardCheck } from 'lucide-react';
import type { Outlet, PaymentMethod, ShiftSummary } from '../../types/pos';

interface Props {
  summary: ShiftSummary | null;
  /** Terminal's outlet, used when the shift record carries none. */
  outlet?: Outlet;
  onClose: () => void;
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  MOBILE_MONEY: 'Mobile Money',
  OTHER: 'Other',
};

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Printable X/Z report on the same 80mm thermal path as a sale receipt — the
 * `receipt-*` classes are print hooks that @media print in index.css unwraps, so
 * a long report is not clipped by the scroll container or the backdrop-filter.
 */
export function ShiftSummaryReceipt({ summary, outlet, onClose }: Props) {
  if (!summary) return null;

  const storeName = summary.shift.till?.outlet?.name ?? outlet?.name ?? 'Sellkit POS Store';
  const storeAddress = summary.shift.till?.outlet?.address ?? outlet?.address;
  const tillName = summary.shift.till?.name ?? 'Till';
  const reportKind = summary.isClosed ? 'Z-REPORT' : 'X-REPORT';
  const netSales = summary.grossSales - summary.taxTotal;

  return (
    <div className="receipt-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="receipt-panel w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-card-foreground">
        <div className="no-print p-4 bg-brand/10 border-b border-brand/20 text-center flex flex-col items-center">
          <ClipboardCheck className="w-9 h-9 text-brand mb-1" />
          <h3 className="font-extrabold text-base text-brand">
            {summary.isClosed ? 'Shift Closed' : 'Shift Summary'}
          </h3>
          <span className="text-xs text-muted">
            {tillName} — {summary.shift.user?.name ?? 'Cashier'}
          </span>
        </div>

        {/* Literal black on white: this previews thermal printer output. */}
        <div className="receipt-scroll flex-1 overflow-y-auto p-5 bg-white text-black font-mono text-xs select-text">
          <div id="printable-receipt" className="space-y-3">
            <div className="text-center space-y-1">
              <h2 className="text-base font-black uppercase tracking-tight">{storeName}</h2>
              {storeAddress && <p className="text-[10px]">{storeAddress}</p>}
              <p className="text-[11px] font-black tracking-widest">{reportKind}</p>
              <div className="border-b border-dashed border-gray-400 my-2" />
            </div>

            <div className="text-[10px] space-y-0.5">
              <div className="flex justify-between">
                <span>Till:</span>
                <span className="font-bold">{tillName}</span>
              </div>
              <div className="flex justify-between">
                <span>Cashier:</span>
                <span>{summary.shift.user?.name ?? 'Staff'}</span>
              </div>
              <div className="flex justify-between">
                <span>Opened:</span>
                <span>{new Date(summary.periodStart).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>{summary.isClosed ? 'Closed:' : 'As of:'}</span>
                <span>{new Date(summary.periodEnd).toLocaleString()}</span>
              </div>
            </div>

            <div className="border-b border-dashed border-gray-400" />

            {/* Sales */}
            <div className="space-y-0.5 text-[11px]">
              <p className="font-black uppercase text-[10px]">Sales</p>
              <div className="flex justify-between">
                <span>Transactions</span>
                <span>{summary.salesCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Net sales</span>
                <span>{money(netSales)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax collected</span>
                <span>{money(summary.taxTotal)}</span>
              </div>
              {summary.discountTotal > 0 && (
                <div className="flex justify-between">
                  <span>Discounts</span>
                  <span>-{money(summary.discountTotal)}</span>
                </div>
              )}
              <div className="flex justify-between font-black border-t border-dashed border-gray-400 pt-1 mt-1">
                <span>GROSS TAKINGS</span>
                <span>{money(summary.grossSales)}</span>
              </div>
            </div>

            <div className="border-b border-dashed border-gray-400" />

            {/* Tender breakdown */}
            <div className="space-y-0.5 text-[11px]">
              <p className="font-black uppercase text-[10px]">Payments</p>
              {summary.byPaymentMethod.length === 0 ? (
                <div className="flex justify-between">
                  <span>No payments taken</span>
                  <span>{money(0)}</span>
                </div>
              ) : (
                summary.byPaymentMethod.map((row) => (
                  <div key={row.paymentMethod} className="flex justify-between">
                    <span>
                      {PAYMENT_LABELS[row.paymentMethod] ?? row.paymentMethod} ({row.count})
                    </span>
                    <span>{money(row.amount)}</span>
                  </div>
                ))
              )}
            </div>

            <div className="border-b border-dashed border-gray-400" />

            {/* Drawer reconciliation */}
            <div className="space-y-0.5 text-[11px]">
              <p className="font-black uppercase text-[10px]">Cash Drawer</p>
              <div className="flex justify-between">
                <span>Opening float</span>
                <span>{money(summary.openingFloat)}</span>
              </div>
              <div className="flex justify-between">
                <span>Cash sales</span>
                <span>{money(summary.cashSales)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Expected in drawer</span>
                <span>{money(summary.expectedCash)}</span>
              </div>
              {summary.actualCash === null ? (
                <p className="text-[10px] italic pt-1">Drawer not counted yet.</p>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span>Counted</span>
                    <span>{money(summary.actualCash)}</span>
                  </div>
                  <div className="flex justify-between font-black border-t border-dashed border-gray-400 pt-1 mt-1">
                    <span>VARIANCE</span>
                    <span>
                      {(summary.discrepancy ?? 0) >= 0 ? '+' : '-'}
                      {money(Math.abs(summary.discrepancy ?? 0))}
                    </span>
                  </div>
                </>
              )}
            </div>

            {summary.shift.notes && (
              <>
                <div className="border-b border-dashed border-gray-400" />
                <div className="text-[10px]">
                  <p className="font-black uppercase">Notes</p>
                  <p className="whitespace-pre-wrap break-words">{summary.shift.notes}</p>
                </div>
              </>
            )}

            <div className="border-b border-dashed border-gray-400" />
            <div className="text-center text-[10px] space-y-0.5 pb-2">
              <p>Cashier signature: ______________________</p>
              <p className="pt-1">{new Date().toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="no-print p-3 border-t border-border flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-surface border border-border text-muted font-bold text-xs hover:text-foreground transition"
          >
            Done
          </button>
          <button
            onClick={() => window.print()}
            className="flex-[1.4] py-3 rounded-xl bg-brand text-brand-foreground font-black text-xs shadow-lg shadow-brand/20 transition hover:brightness-110 flex items-center justify-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            Print Report
          </button>
        </div>
      </div>
    </div>
  );
}
