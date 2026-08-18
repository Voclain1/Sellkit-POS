import React, { useState } from 'react';
import { CreditCard, DollarSign, Split, X, UserCheck, ArrowRight, AlertTriangle } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { CartItem, Customer, PaymentMethod, PaymentSplitInput, SaleReceipt } from '../../types/pos';
import { apiFetch } from '../../lib/api';
import { queueOfflineSale } from '../../lib/offline/db';
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
  onClose: () => void;
  onSuccess: (receipt: SaleReceipt) => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  cart,
  customer,
  outletId,
  tillId,
  taxRate = 0.08,
  modifiers = emptyModifiers,
  isOnline,
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

      const checkoutPayload = {
        outletId,
        tillId,
        customerId: customer?.id || undefined,
        items: cart.map((i) => ({
          productVariantId: i.variant.id,
          quantity: i.quantity,
          unitPrice: i.unitPrice * (1 - (i.discount || 0) / 100),
        })),
        paymentSplits: splits,
        tax: taxAmount,
        discount: orderDiscount,
        isOfflineSync: !isOnline,
      };

      let receipt: SaleReceipt;

      if (isOnline) {
        receipt = await apiFetch('/sales/checkout', {
          method: 'POST',
          body: JSON.stringify(checkoutPayload),
        });
      } else {
        // Queue locally in IndexedDB when offline
        const queuedItem = await queueOfflineSale(checkoutPayload);
        receipt = {
          id: queuedItem.id,
          receiptNumber: queuedItem.id,
          totalAmount: netTotal,
          tax: taxAmount,
          discount: orderDiscount,
          isOfflineSync: true,
          createdAt: new Date().toISOString(),
          user: { name: 'Offline Cashier', email: 'cashier@sellkitpos.com' },
          customer: customer || undefined,
          saleItems: cart.map((i, idx) => ({
            id: `item-${idx}`,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            totalPrice: i.unitPrice * i.quantity,
            productVariant: i.variant,
          })),
          paymentSplits: splits.map((s, idx) => ({
            id: `split-${idx}`,
            paymentMethod: s.paymentMethod,
            amount: s.amount,
          })),
        };
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-card-foreground">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface">
          <div>
            <h2 className="text-xl font-black tracking-tight">Payment & Checkout</h2>
            <p className="text-xs text-muted">Select payment tender and complete sale transaction</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-muted hover:text-foreground bg-surface border border-border rounded-xl transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column: Payment Method Selection */}
          <div className="space-y-4">
            <label className="block text-xs font-extrabold uppercase tracking-wider text-muted">
              Select Payment Method
            </label>

            <div className="grid grid-cols-1 gap-2.5">
              <button
                type="button"
                onClick={() => setSelectedMethod('CASH')}
                className={`p-4 rounded-xl border flex items-center gap-3 transition text-left ${
                  selectedMethod === 'CASH'
                    ? 'bg-success/10 border-success text-success shadow-md shadow-success/10'
                    : 'bg-surface border-border text-foreground hover:bg-border/60'
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-success/20 text-success flex items-center justify-center font-bold">
                  <DollarSign className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-sm">Cash Payment</h4>
                  <span className="text-xs opacity-75">Quick change calculator & exact cash</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMethod('CARD')}
                className={`p-4 rounded-xl border flex items-center gap-3 transition text-left ${
                  selectedMethod === 'CARD'
                    ? 'bg-brand/10 border-brand text-brand shadow-md shadow-brand/10'
                    : 'bg-surface border-border text-foreground hover:bg-border/60'
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-brand/20 text-brand flex items-center justify-center font-bold">
                  <CreditCard className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-sm">Credit / Debit Card</h4>
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
                className={`p-4 rounded-xl border flex items-center gap-3 transition text-left ${
                  selectedMethod === 'OTHER'
                    ? 'bg-accent/10 border-accent text-accent shadow-md shadow-accent/10'
                    : 'bg-surface border-border text-foreground hover:bg-border/60'
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-accent/20 text-accent flex items-center justify-center font-bold">
                  <Split className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-sm">Split Tender</h4>
                  <span className="text-xs opacity-75">Combine Cash + Card payment breakdown</span>
                </div>
              </button>
            </div>

            {modifiers.note.trim() && (
              <div className="mt-4 p-3 bg-surface border border-border rounded-xl">
                <span className="text-[10px] font-bold uppercase text-muted">Order note</span>
                <p className="text-xs mt-1 whitespace-pre-wrap break-words">{modifiers.note}</p>
              </div>
            )}

            {/* Attached Customer Info */}
            {customer && (
              <div className="mt-4 p-3 bg-surface border border-border rounded-xl flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-success/20 text-success flex items-center justify-center">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div className="flex flex-col text-xs">
                  <span className="font-bold text-foreground">{customer.name}</span>
                  <span className="text-amber-400 font-mono">
                    Earns +{Math.floor(netTotal / 10)} Loyalty Points
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Dynamic Tender Calculator & Amount */}
          <div className="space-y-4 flex flex-col justify-between">
            <div>
              <div className="p-4 bg-surface border border-border rounded-xl mb-4 text-center">
                <span className="text-xs font-semibold uppercase text-muted">Total Amount Due</span>
                <div className="text-3xl font-black font-mono text-success mt-1">
                  ${netTotal.toFixed(2)}
                </div>
              </div>

              {selectedMethod === 'CASH' && (
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-muted">Amount Tendered ($)</label>

                  <input
                    type="number"
                    step="0.01"
                    value={tenderedAmountInput}
                    onChange={(e) => setTenderedAmountInput(e.target.value)}
                    placeholder={netTotal.toFixed(2)}
                    className="w-full px-4 py-3 bg-surface border border-border rounded-xl text-2xl font-bold font-mono text-foreground focus:outline-none focus:border-brand"
                    autoFocus
                  />

                  {/* Quick Cash Preset Buttons */}
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => handleQuickTender(netTotal)}
                      className="py-2 bg-surface hover:bg-border/60 border border-border text-xs font-bold font-mono text-foreground rounded-lg transition"
                    >
                      Exact
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickTender(20)}
                      className="py-2 bg-surface hover:bg-border/60 border border-border text-xs font-bold font-mono text-foreground rounded-lg transition"
                    >
                      $20
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickTender(50)}
                      className="py-2 bg-surface hover:bg-border/60 border border-border text-xs font-bold font-mono text-foreground rounded-lg transition"
                    >
                      $50
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickTender(100)}
                      className="py-2 bg-surface hover:bg-border/60 border border-border text-xs font-bold font-mono text-foreground rounded-lg transition"
                    >
                      $100
                    </button>
                  </div>

                  {/* Change Due Display */}
                  <div className="p-3 bg-surface border border-border rounded-xl flex items-center justify-between">
                    <span className="text-xs font-bold text-muted">Change Due:</span>
                    <span className="text-xl font-extrabold font-mono text-success">
                      ${changeDue.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {selectedMethod === 'OTHER' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">Cash Portion ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={splitCashInput}
                      onChange={(e) => setSplitCashInput(e.target.value)}
                      className="w-full px-3 py-2 bg-surface border border-border rounded-xl text-lg font-mono text-foreground focus:outline-none focus:border-brand"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">Card Portion ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={splitCardInput}
                      onChange={(e) => setSplitCardInput(e.target.value)}
                      className="w-full px-3 py-2 bg-surface border border-border rounded-xl text-lg font-mono text-foreground focus:outline-none focus:border-brand"
                    />
                  </div>
                </div>
              )}
            </div>

            {errorMessage && (
              <div className="text-xs font-semibold text-danger bg-danger/10 p-3 rounded-xl border border-danger/20">
                {errorMessage}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 border-t border-border bg-surface flex items-center justify-end gap-3">
          {!isTerminalReady && (
            <div className="mr-auto flex items-center gap-2 text-[11px] font-semibold text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Terminal not bound to an outlet/till yet
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 bg-surface hover:bg-border/60 border border-border font-bold text-xs text-muted rounded-xl transition"
          >
            Back to Cart
          </button>
          <button
            type="button"
            onClick={handleCompleteCheckout}
            disabled={isSubmitting || !isTerminalReady}
            className="px-6 py-3 bg-success hover:brightness-110 disabled:opacity-50 text-success-foreground font-extrabold text-sm rounded-xl shadow-lg transition flex items-center gap-2"
          >
            {isSubmitting ? 'Processing...' : 'Complete Sale'}
            <ArrowRight className="w-4 h-4 stroke-[3]" />
          </button>
        </div>
      </div>
    </div>
  );
};
