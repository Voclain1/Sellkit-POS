import React, { useState } from 'react';
import { CreditCard, DollarSign, Split, X, UserCheck, ArrowRight, AlertTriangle } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { CartItem, Customer, PaymentMethod, PaymentSplitInput, SaleReceipt, User } from '../../types/pos';
import { apiFetch, ApiError } from '../../lib/api';
import { queueOfflineSale } from '../../lib/offline/db';
import { newClientSaleId } from '../../lib/ids';
import { computeCartTotals, emptyModifiers, type OrderModifiers } from '../../lib/cartTotals';

interface CheckoutModalProps {
  isOpen: boolean;
  cart: CartItem[];
  customer: Customer | null;
  /** Outlet and till this terminal posts against, from GET /api/bootstrap. */
  outletId?: string;
  tillId?: string;
  taxRate?: number;
  /**
   * Order-level discount / coupon / note from the checkout panel. Totals are
   * derived from the same helper the panel uses, so the amount charged is always
   * the amount the cashier read out. The note is displayed only — Sale has no
   * notes column.
   */
  modifiers?: OrderModifiers;
  isOnline: boolean;
  /** Open shift on this till; stamped on the sale so it counts towards it. */
  shiftId?: string;
  /** Signed-in cashier, printed on offline receipts and credited with the sale. */
  cashier?: User | null;
  /** The server says the till's prices are stale; reload the catalogue. */
  onCatalogStale?: () => void;
  onClose: () => void;
  onSuccess: (receipt: SaleReceipt) => void;
}

/** How long an online checkout may take before the sale is queued instead. */
const CHECKOUT_TIMEOUT_MS = 15000;

/** 409 codes that mean the till's catalogue is out of date. */
const STALE_CATALOG_CODES = new Set(['PRICE_CHANGED', 'TAX_CHANGED', 'TOTAL_MISMATCH']);

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  cart,
  customer,
  outletId,
  tillId,
  taxRate = 0.08,
  modifiers = emptyModifiers,
  isOnline,
  shiftId,
  cashier,
  onCatalogStale,
  onClose,
  onSuccess,
}) => {
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('CASH');
  const [tenderedAmountInput, setTenderedAmountInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Split Payment Inputs
  const [splitCashInput, setSplitCashInput] = useState<string>('');
  const [splitCardInput, setSplitCardInput] = useState<string>('');

  if (!isOpen) return null;

  // Calculation totals — single source of truth, shared with CheckoutPanel.
  const {
    tax: taxAmount,
    orderDiscount,
    total: netTotal,
  } = computeCartTotals(cart, taxRate, modifiers);

  const tenderedAmount = parseFloat(tenderedAmountInput) || 0;
  const changeDue = Math.max(0, tenderedAmount - netTotal);
  const isTerminalReady = Boolean(outletId && tillId);

  const handleQuickTender = (amount: number) => {
    setTenderedAmountInput(amount.toFixed(2));
  };

  const handleCompleteCheckout = async () => {
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      // Without a resolved outlet/till the sale would fail its foreign-key checks
      // server-side, and offline it would queue a payload that can never sync.
      if (!outletId || !tillId) {
        throw new Error(
          'Terminal is not bound to an outlet and till yet. Reconnect and try again.'
        );
      }

      let splits: PaymentSplitInput[] = [];

      if (selectedMethod === 'CASH') {
        if (tenderedAmount < netTotal) {
          throw new Error(`Tendered cash ($${tenderedAmount.toFixed(2)}) is less than total amount due ($${netTotal.toFixed(2)})`);
        }
        splits = [{ paymentMethod: 'CASH', amount: netTotal }];
      } else if (selectedMethod === 'CARD') {
        splits = [{ paymentMethod: 'CARD', amount: netTotal }];
      } else if (selectedMethod === 'OTHER') {
        // Split tender logic
        const cashVal = parseFloat(splitCashInput) || 0;
        const cardVal = parseFloat(splitCardInput) || 0;
        if (Math.abs(cashVal + cardVal - netTotal) > 0.01) {
          throw new Error(`Split sum ($${(cashVal + cardVal).toFixed(2)}) does not match net total ($${netTotal.toFixed(2)})`);
        }
        splits = [];
        if (cashVal > 0) splits.push({ paymentMethod: 'CASH', amount: cashVal });
        if (cardVal > 0) splits.push({ paymentMethod: 'CARD', amount: cardVal });
      }

      // One id per sale, generated before the first attempt. If this POST lands
      // but the response is lost, the queued copy carries the same id and the
      // server returns the original sale instead of recording it twice.
      const checkoutPayload = {
        clientSaleId: newClientSaleId(),
        soldAt: new Date().toISOString(),
        soldByUserId: cashier?.id,
        outletId,
        tillId,
        shiftId,
        customerId: customer?.id || undefined,
        // List price plus the line discount, not a pre-discounted price: the
        // server prices online sales from its own catalogue and needs both.
        items: cart.map((i) => ({
          productVariantId: i.variant.id,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discountPercent: i.discount || 0,
        })),
        paymentSplits: splits,
        tax: taxAmount,
        discount: orderDiscount,
      };

      const queueLocally = async (): Promise<SaleReceipt> => {
        const queuedItem = await queueOfflineSale({ ...checkoutPayload, isOfflineSync: true });
        return {
          id: queuedItem.id,
          receiptNumber: queuedItem.id,
          totalAmount: netTotal,
          tax: taxAmount,
          discount: orderDiscount,
          isOfflineSync: true,
          createdAt: checkoutPayload.soldAt,
          user: { name: cashier?.name ?? 'Cashier', email: cashier?.email ?? '' },
          customer: customer || undefined,
          // What the customer was actually charged per unit, after line discount,
          // so the paper receipt adds up to the total they paid.
          saleItems: cart.map((i, idx) => {
            const charged = i.unitPrice * (1 - (i.discount || 0) / 100);
            return {
              id: `item-${idx}`,
              quantity: i.quantity,
              unitPrice: charged,
              totalPrice: charged * i.quantity,
              productVariant: i.variant,
            };
          }),
          paymentSplits: splits.map((s, idx) => ({
            id: `split-${idx}`,
            paymentMethod: s.paymentMethod,
            amount: s.amount,
          })),
        };
      };

      let receipt: SaleReceipt;

      if (isOnline) {
        try {
          receipt = await apiFetch('/sales/checkout', {
            method: 'POST',
            body: JSON.stringify({ ...checkoutPayload, isOfflineSync: false }),
            timeoutMs: CHECKOUT_TIMEOUT_MS,
          });
        } catch (err) {
          // The device thinks it is online but the server is down, slow or
          // erroring. The sale must still go through: queue it. If the POST in
          // fact landed, the shared clientSaleId makes the replay a no-op.
          if (err instanceof ApiError && err.isRetryable) {
            console.warn('Checkout could not reach the server; queued for sync.', err);
            receipt = await queueLocally();
          } else {
            const code = err instanceof ApiError ? (err.payload as { code?: string } | undefined)?.code : undefined;
            if (code && STALE_CATALOG_CODES.has(code)) onCatalogStale?.();
            throw err;
          }
        }
      } else {
        receipt = await queueLocally();
      }

      // Trigger Confetti effect!
      confetti({
        particleCount: 60,
        spread: 70,
        origin: { y: 0.6 },
      });

      onSuccess(receipt);
    } catch (err: any) {
      setErrorMessage(err.message || 'Checkout process failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="panel w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-elevated">
          <div className="leading-tight">
            <span className="micro-label">Checkout</span>
            <h2 className="text-xl font-semibold tracking-tight">Payment &amp; Tender</h2>
          </div>
          <button
            onClick={onClose}
            className="btn-quiet p-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column: Payment Method Selection */}
          <div className="space-y-4">
            <label className="micro-label block">Select Payment Method</label>

            <div className="grid grid-cols-1 gap-2.5">
              <button
                type="button"
                onClick={() => setSelectedMethod('CASH')}
                className={`p-4 rounded-xl border flex items-center gap-3 text-left transition duration-150 active:scale-[0.99] ${
                  selectedMethod === 'CASH'
                    ? 'bg-success/10 border-success/60 text-success ring-1 ring-inset ring-success/25'
                    : 'bg-surface border-border text-foreground hover:border-muted/40'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-success/12 text-success ring-1 ring-inset ring-success/25 flex items-center justify-center">
                  <DollarSign className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm">Cash Payment</h4>
                  <span className="text-xs opacity-75">Quick change calculator & exact cash</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMethod('CARD')}
                className={`p-4 rounded-xl border flex items-center gap-3 text-left transition duration-150 active:scale-[0.99] ${
                  selectedMethod === 'CARD'
                    ? 'bg-brand/10 border-brand/60 text-brand ring-1 ring-inset ring-brand/25'
                    : 'bg-surface border-border text-foreground hover:border-muted/40'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-brand/12 text-brand ring-1 ring-inset ring-brand/25 flex items-center justify-center">
                  <CreditCard className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm">Credit / Debit Card</h4>
                  <span className="text-xs opacity-75">EMV Chip, Contactless NFC, Swipe</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedMethod('OTHER');
                  setSplitCashInput((netTotal / 2).toFixed(2));
                  setSplitCardInput((netTotal / 2).toFixed(2));
                }}
                className={`p-4 rounded-xl border flex items-center gap-3 text-left transition duration-150 active:scale-[0.99] ${
                  selectedMethod === 'OTHER'
                    ? 'bg-accent/10 border-accent/60 text-accent ring-1 ring-inset ring-accent/25'
                    : 'bg-surface border-border text-foreground hover:border-muted/40'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-accent/12 text-accent ring-1 ring-inset ring-accent/25 flex items-center justify-center">
                  <Split className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm">Split Tender</h4>
                  <span className="text-xs opacity-75">Combine Cash + Card payment breakdown</span>
                </div>
              </button>
            </div>

            {modifiers.note.trim() && (
              <div className="mt-4 p-3 bg-surface border border-border rounded-xl">
                <span className="micro-label">Order note</span>
                <p className="text-xs mt-1 whitespace-pre-wrap break-words">{modifiers.note}</p>
              </div>
            )}

            {/* Attached Customer Info */}
            {customer && (
              <div className="mt-4 p-3 bg-surface border border-border rounded-xl flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-success/12 text-success ring-1 ring-inset ring-success/25 flex items-center justify-center">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div className="flex flex-col text-xs">
                  <span className="font-semibold text-foreground">{customer.name}</span>
                  <span className="num text-warning">
                    Earns +{Math.floor(netTotal / 10)} Loyalty Points
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Dynamic Tender Calculator & Amount */}
          <div className="space-y-4 flex flex-col justify-between">
            <div>
              <div className="p-4 bg-elevated border border-border rounded-xl mb-4 text-center shadow-[var(--shadow-raised)]">
                <span className="micro-label">Total Amount Due</span>
                <div className="num-display text-4xl mt-1.5">${netTotal.toFixed(2)}</div>
              </div>

              {selectedMethod === 'CASH' && (
                <div className="space-y-3">
                  <label className="micro-label block">Amount Tendered ($)</label>

                  <input
                    type="number"
                    step="0.01"
                    value={tenderedAmountInput}
                    onChange={(e) => setTenderedAmountInput(e.target.value)}
                    placeholder={netTotal.toFixed(2)}
                    className="field num px-4 py-3 text-2xl font-semibold"
                    autoFocus
                  />

                  {/* Quick Cash Preset Buttons */}
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => handleQuickTender(netTotal)}
                      className="btn-quiet num py-2 text-xs rounded-lg hover:text-foreground"
                    >
                      Exact
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickTender(20)}
                      className="btn-quiet num py-2 text-xs rounded-lg hover:text-foreground"
                    >
                      $20
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickTender(50)}
                      className="btn-quiet num py-2 text-xs rounded-lg hover:text-foreground"
                    >
                      $50
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickTender(100)}
                      className="btn-quiet num py-2 text-xs rounded-lg hover:text-foreground"
                    >
                      $100
                    </button>
                  </div>

                  {/* Change Due Display */}
                  <div className="p-3 bg-surface border border-border rounded-xl flex items-center justify-between">
                    <span className="micro-label">Change Due</span>
                    <span className="num text-xl font-semibold text-success">
                      ${changeDue.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {selectedMethod === 'OTHER' && (
                <div className="space-y-3">
                  <div>
                    <label className="micro-label block mb-1.5">Cash Portion ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={splitCashInput}
                      onChange={(e) => setSplitCashInput(e.target.value)}
                      className="field num px-3 py-2 text-lg"
                    />
                  </div>
                  <div>
                    <label className="micro-label block mb-1.5">Card Portion ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={splitCardInput}
                      onChange={(e) => setSplitCardInput(e.target.value)}
                      className="field num px-3 py-2 text-lg"
                    />
                  </div>
                </div>
              )}
            </div>

            {errorMessage && (
              <div className="text-xs font-medium text-danger bg-danger/10 p-3 rounded-xl ring-1 ring-inset ring-danger/25">
                {errorMessage}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 border-t border-border bg-elevated flex items-center justify-end gap-3">
          {!isTerminalReady && (
            <div className="mr-auto flex items-center gap-2 text-[11px] font-medium text-warning">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Terminal not bound to an outlet/till yet
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="btn-quiet px-5 py-3 text-xs"
          >
            Back to Cart
          </button>
          <button
            type="button"
            onClick={handleCompleteCheckout}
            disabled={isSubmitting || !isTerminalReady}
            className="btn-success px-6 py-3 text-sm"
          >
            {isSubmitting ? 'Processing...' : 'Complete Sale'}
            <ArrowRight className="w-4 h-4 stroke-[3]" />
          </button>
        </div>
      </div>
    </div>
  );
};
