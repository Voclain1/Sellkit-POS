import { useEffect, useState } from 'react';
import {
  ShoppingCart,
  Trash2,
  Tag,
  Percent,
  DollarSign,
  PauseCircle,
  CheckCircle2,
  Ticket,
  StickyNote,
  RotateCcw,
  X,
} from 'lucide-react';
import type { CartItem, Customer } from '../../types/pos';
import type { HeldCart } from '../../lib/offline/db';
import { computeCartTotals, type OrderModifiers } from '../../lib/cartTotals';
import { CartItemCard } from './CartItemCard';

type ModifierTab = 'discount' | 'coupon' | 'note';

interface Props {
  cart: CartItem[];
  customer: Customer | null;
  taxRate?: number;
  /** Delta-based, matching the App cart reducer. */
  onUpdateQty: (variantId: string, delta: number) => void;
  onRemove: (variantId: string) => void;
  onDiscount: (variantId: string, pct: number) => void;
  onClearCart: () => void;
  onOpenCustomer: () => void;
  /** Opens the payment modal. */
  onProceed: () => void;
  modifiers: OrderModifiers;
  onModifiersChange: (modifiers: OrderModifiers) => void;
  heldCarts?: HeldCart[];
  onHoldCart?: () => void;
  onRecallCart?: (id: string) => void;
  onDiscardHeldCart?: (id: string) => void;
  /**
   * Redeem a coupon code. There is no coupon endpoint yet, so App leaves this
   * undefined and the tab renders disabled rather than pretending to apply one.
   */
  onApplyCoupon?: (code: string) => void;
}

export function CheckoutPanel({
  cart,
  customer,
  taxRate = 0.08,
  onUpdateQty,
  onRemove,
  onDiscount,
  onClearCart,
  onOpenCustomer,
  onProceed,
  modifiers,
  onModifiersChange,
  heldCarts = [],
  onHoldCart,
  onRecallCart,
  onDiscardHeldCart,
  onApplyCoupon,
}: Props) {
  const [activeTab, setActiveTab] = useState<ModifierTab | null>(null);

  const { subtotal, tax, orderDiscount, total } = computeCartTotals(cart, taxRate, modifiers);
  const itemCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const isEmpty = cart.length === 0;

  const patch = (next: Partial<OrderModifiers>) => onModifiersChange({ ...modifiers, ...next });

  useEffect(() => {
    if (isEmpty) setActiveTab(null);
  }, [isEmpty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.key === 'F2' || (e.key === ' ' && !isTyping && tag === 'BODY')) {
        e.preventDefault();
        if (cart.length > 0) onProceed();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart, onProceed]);

  const tabButton = (tab: ModifierTab, label: string, Icon: typeof Percent, marked: boolean) => (
    <button
      type="button"
      onClick={() => setActiveTab((cur) => (cur === tab ? null : tab))}
      className={`flex items-center gap-1 transition-colors ${
        activeTab === tab ? 'text-brand' : 'text-muted hover:text-foreground'
      }`}
    >
      <Icon className="w-3 h-3" />
      {label}
      {marked && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
    </button>
  );

  return (
    <div className="w-full lg:w-[380px] xl:w-[400px] bg-card border-l border-border flex flex-col h-full select-none shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand/10 text-brand flex items-center justify-center">
            <ShoppingCart className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="font-bold text-xs">Current Order</h2>
            <span className="text-[10px] text-muted">
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </span>
          </div>
        </div>
        {!isEmpty && (
          <button
            onClick={onClearCart}
            className="text-[11px] text-muted hover:text-danger flex items-center gap-1 transition"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      {/* Customer */}
      <div className="px-3 py-2 border-b border-border">
        {customer ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px]">
              <Tag className="w-3 h-3 text-success" />
              <span className="font-bold">{customer.name}</span>
              <span className="text-amber-500 font-mono">{customer.loyaltyPoints} pts</span>
            </div>
            <button onClick={onOpenCustomer} className="text-[10px] text-brand font-semibold">
              Change
            </button>
          </div>
        ) : (
          <button
            onClick={onOpenCustomer}
            className="w-full py-1.5 bg-surface border border-border text-[11px] font-semibold text-muted rounded-lg flex items-center justify-center gap-1.5 hover:text-foreground transition"
          >
            <Tag className="w-3 h-3 text-brand" />
            Attach Customer
          </button>
        )}
      </div>

      {/* Parked carts. Recall is the whole point of holding one, so the list
          lives here rather than behind a menu. */}
      {heldCarts.length > 0 && (
        <div className="px-3 py-2 border-b border-border space-y-1.5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
            On hold ({heldCarts.length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {heldCarts.map((held) => (
              <span
                key={held.id}
                className="flex items-center gap-1 bg-surface border border-border rounded-lg pl-2 pr-1 py-1 text-[10px]"
              >
                <button
                  onClick={() => onRecallCart?.(held.id)}
                  title={`Recall ${held.label}`}
                  className="flex items-center gap-1 font-semibold hover:text-brand transition"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  {held.label}
                  <span className="text-muted font-mono">
                    {held.cart.reduce((s, i) => s + i.quantity, 0)}
                  </span>
                </button>
                <button
                  onClick={() => onDiscardHeldCart?.(held.id)}
                  title={`Discard ${held.label}`}
                  aria-label={`Discard ${held.label}`}
                  className="text-muted hover:text-danger transition"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Line items */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center text-muted text-center py-12">
            <ShoppingCart className="w-10 h-10 mb-2 stroke-[1.2] opacity-30" />
            <p className="font-semibold text-xs">Cart is empty</p>
            <span className="text-[10px] mt-1 max-w-[180px]">Tap products or scan barcode</span>
          </div>
        ) : (
          cart.map((item, index) => (
            <CartItemCard
              key={item.variant.id}
              index={index}
              item={item}
              onUpdateQuantity={(variantId, newQty) =>
                onUpdateQty(variantId, newQty - item.quantity)
              }
              onUpdateDiscount={onDiscount}
              onRemoveItem={onRemove}
            />
          ))
        )}
      </div>

      {/* Summary footer */}
      <div className="p-3 bg-surface/80 border-t border-border">
        {/* Modifier tabs */}
        <div className="flex items-center justify-between text-[11px] font-bold pb-2 mb-2 border-b border-border">
          <span className="text-muted uppercase tracking-wider text-[9px]">Add</span>
          <div className="flex gap-3">
            {tabButton('discount', 'Discount', Percent, orderDiscount > 0)}
            {tabButton('coupon', 'Coupon', Ticket, Boolean(modifiers.couponCode.trim()))}
            {tabButton('note', 'Note', StickyNote, Boolean(modifiers.note.trim()))}
          </div>
        </div>

        {activeTab === 'discount' && (
          <div className="flex items-center gap-2 mb-3">
            <div className="flex rounded-lg border border-border overflow-hidden h-8 shrink-0">
              <button
                onClick={() => patch({ discountMode: 'percent' })}
                aria-label="Discount as percentage"
                className={`px-2.5 h-full transition ${
                  modifiers.discountMode === 'percent'
                    ? 'bg-brand text-brand-foreground'
                    : 'bg-card text-muted'
                }`}
              >
                <Percent className="w-3 h-3" />
              </button>
              <button
                onClick={() => patch({ discountMode: 'amount' })}
                aria-label="Discount as fixed amount"
                className={`px-2.5 h-full border-l border-border transition ${
                  modifiers.discountMode === 'amount'
                    ? 'bg-brand text-brand-foreground'
                    : 'bg-card text-muted'
                }`}
              >
                <DollarSign className="w-3 h-3" />
              </button>
            </div>
            <input
              type="number"
              min="0"
              max={modifiers.discountMode === 'percent' ? 100 : undefined}
              step="0.01"
              inputMode="decimal"
              placeholder={
                modifiers.discountMode === 'percent' ? 'Order discount %' : 'Order discount amount'
              }
              value={modifiers.discountInput}
              onChange={(e) => patch({ discountInput: e.target.value })}
              className="flex-1 h-8 px-2.5 rounded-lg border border-border bg-card text-[11px] font-bold font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
        )}

        {activeTab === 'coupon' && (
          <div className="mb-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <input
                value={modifiers.couponCode}
                onChange={(e) => patch({ couponCode: e.target.value.toUpperCase() })}
                disabled={!onApplyCoupon}
                placeholder="COUPON CODE"
                className="flex-1 h-8 px-2.5 rounded-lg border border-border bg-card text-[11px] font-bold font-mono tracking-wider focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-40"
              />
              <button
                onClick={() => onApplyCoupon?.(modifiers.couponCode.trim())}
                disabled={!onApplyCoupon || !modifiers.couponCode.trim()}
                className="h-8 px-3 rounded-lg bg-brand text-brand-foreground text-[11px] font-bold disabled:opacity-30 transition"
              >
                Apply
              </button>
            </div>
            {!onApplyCoupon && (
              <p className="text-[10px] text-muted">
                Coupon redemption isn&apos;t enabled on this terminal yet — use Discount instead.
              </p>
            )}
          </div>
        )}

        {activeTab === 'note' && (
          <textarea
            rows={2}
            value={modifiers.note}
            onChange={(e) => patch({ note: e.target.value })}
            placeholder="Order note (stays on this terminal)"
            className="w-full mb-3 px-2.5 py-2 rounded-lg border border-border bg-card text-[11px] resize-none focus:outline-none focus:ring-1 focus:ring-brand"
          />
        )}

        {/* Totals */}
        <div className="space-y-1 text-[11px] text-muted mb-3">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="font-mono text-foreground">${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Tax ({(taxRate * 100).toFixed(0)}%)</span>
            <span className="font-mono text-foreground">${tax.toFixed(2)}</span>
          </div>
          {orderDiscount > 0 && (
            <div className="flex justify-between">
              <span>Order discount</span>
              <span className="font-mono text-amber-500">-${orderDiscount.toFixed(2)}</span>
            </div>
          )}
          <div className="pt-1.5 border-t border-border flex justify-between items-baseline">
            <span className="text-sm font-bold text-foreground">Payable Amount</span>
            <span className="text-xl font-black font-mono text-success">${total.toFixed(2)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onHoldCart}
            disabled={isEmpty || !onHoldCart}
            className="flex-1 py-3 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-bold text-xs transition hover:bg-amber-500/20 disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            <PauseCircle className="w-4 h-4" />
            Hold Cart
          </button>
          <button
            type="button"
            onClick={onProceed}
            disabled={isEmpty}
            className="flex-[1.4] py-3 rounded-xl bg-success text-success-foreground font-black text-sm shadow-lg shadow-success/20 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            Proceed
            <kbd className="text-[9px] font-mono bg-black/20 px-1 py-0.5 rounded">F2</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
