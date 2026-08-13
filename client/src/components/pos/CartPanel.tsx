import { useState, useEffect } from 'react';
import { ShoppingCart, Plus, Minus, Trash2, Tag, ArrowRight, Percent } from 'lucide-react';
import type { CartItem, Customer } from '../../types/pos';

interface Props {
  cart: CartItem[];
  customer: Customer | null;
  taxRate?: number;
  onUpdateQty: (variantId: string, delta: number) => void;
  onRemove: (variantId: string) => void;
  onDiscount: (variantId: string, pct: number) => void;
  onClearCart: () => void;
  onOpenCustomer: () => void;
  onCharge: () => void;
}

export function CartPanel({ cart, customer, taxRate = 0.08, onUpdateQty, onRemove, onDiscount, onClearCart, onOpenCustomer, onCharge }: Props) {
  const [discItem, setDiscItem] = useState<CartItem | null>(null);
  const [discVal, setDiscVal] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2' || (e.key === ' ' && document.activeElement?.tagName === 'BODY')) {
        e.preventDefault();
        if (cart.length > 0) onCharge();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart, onCharge]);

  const subtotal = cart.reduce((s, i) => s + i.unitPrice * (1 - (i.discount || 0) / 100) * i.quantity, 0);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  const saveDisc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!discItem) return;
    const v = parseFloat(discVal);
    onDiscount(discItem.variant.id, isNaN(v) ? 0 : Math.min(100, Math.max(0, v)));
    setDiscItem(null); setDiscVal('');
  };

  return (
    <div className="w-full lg:w-[380px] xl:w-[400px] bg-card border-l border-border flex flex-col h-full select-none shrink-0">
      {/* Top */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand/10 text-brand flex items-center justify-center"><ShoppingCart className="w-3.5 h-3.5" /></div>
          <div><h2 className="font-bold text-xs">Current Order</h2><span className="text-[10px] text-muted">{cart.reduce((s, i) => s + i.quantity, 0)} items</span></div>
        </div>
        {cart.length > 0 && <button onClick={onClearCart} className="text-[11px] text-muted hover:text-danger flex items-center gap-1 transition"><Trash2 className="w-3 h-3" />Clear</button>}
      </div>

      {/* Customer */}
      <div className="px-3 py-2 border-b border-border">
        {customer ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px]"><Tag className="w-3 h-3 text-success" /><span className="font-bold">{customer.name}</span><span className="text-amber-400 font-mono">{customer.loyaltyPoints} pts</span></div>
            <button onClick={onOpenCustomer} className="text-[10px] text-brand font-semibold">Change</button>
          </div>
        ) : (
          <button onClick={onOpenCustomer} className="w-full py-1.5 bg-surface border border-border text-[11px] font-semibold text-muted rounded-lg flex items-center justify-center gap-1.5 hover:text-foreground transition">
            <Tag className="w-3 h-3 text-brand" />Attach Customer
          </button>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted text-center py-12">
            <ShoppingCart className="w-10 h-10 mb-2 stroke-[1.2] opacity-30" />
            <p className="font-semibold text-xs">Cart empty</p>
            <span className="text-[10px] mt-1 max-w-[180px]">Tap products or scan barcode</span>
          </div>
        ) : cart.map(item => {
          const ep = item.unitPrice * (1 - (item.discount || 0) / 100);
          const lt = ep * item.quantity;
          return (
            <div key={item.variant.id} className="p-2.5 bg-surface border border-border rounded-lg space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div><span className="font-bold text-[11px] line-clamp-1">{item.productName}</span><span className="text-[9px] text-muted font-mono block">{item.variant.sku}</span></div>
                <button onClick={() => onRemove(item.variant.id)} className="text-muted hover:text-danger p-0.5"><Trash2 className="w-3 h-3" /></button>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 bg-card p-0.5 rounded-md border border-border">
                  <button onClick={() => onUpdateQty(item.variant.id, -1)} className="w-6 h-6 rounded bg-surface flex items-center justify-center hover:bg-border transition"><Minus className="w-3 h-3" /></button>
                  <span className="w-7 text-center font-bold text-[11px] font-mono">{item.quantity}</span>
                  <button onClick={() => onUpdateQty(item.variant.id, 1)} className="w-6 h-6 rounded bg-surface flex items-center justify-center hover:bg-border transition"><Plus className="w-3 h-3" /></button>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setDiscItem(item); setDiscVal(item.discount > 0 ? String(item.discount) : ''); }}
                    className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border flex items-center gap-0.5 ${item.discount > 0 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-surface text-muted border-border hover:text-foreground'}`}>
                    <Percent className="w-2.5 h-2.5" />{item.discount > 0 ? `${item.discount}%` : 'Disc'}
                  </button>
                  <span className="text-[11px] font-bold font-mono">${lt.toFixed(2)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Totals + Charge */}
      <div className="p-3 bg-surface/80 border-t border-border space-y-2">
        <div className="space-y-1 text-[11px] text-muted">
          <div className="flex justify-between"><span>Subtotal</span><span className="font-mono text-foreground">${subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>Tax (8%)</span><span className="font-mono text-foreground">${tax.toFixed(2)}</span></div>
          <div className="pt-1.5 border-t border-border flex justify-between items-baseline">
            <span className="text-sm font-bold text-foreground">Total</span>
            <span className="text-xl font-black font-mono text-success">${total.toFixed(2)}</span>
          </div>
        </div>
        <button onClick={onCharge} disabled={cart.length === 0}
          className="w-full py-3.5 bg-success hover:brightness-110 disabled:opacity-30 text-success-foreground font-black text-base rounded-xl shadow-lg shadow-success/20 transition flex items-center justify-between px-4 active:scale-[0.99]">
          <div className="flex items-center gap-2">
            <span>CHARGE</span>
            <kbd className="text-[10px] font-mono bg-black/20 px-1.5 py-0.5 rounded">F2</kbd>
          </div>
          <div className="flex items-center gap-1 font-mono">${total.toFixed(2)}<ArrowRight className="w-4 h-4 stroke-[3]" /></div>
        </button>
      </div>

      {/* Discount modal */}
      {discItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <form onSubmit={saveDisc} className="w-full max-w-xs bg-card border border-border rounded-xl p-5 shadow-2xl">
            <h3 className="font-bold text-sm mb-1">Item Discount</h3>
            <p className="text-[11px] text-muted mb-3">For <span className="font-semibold text-foreground">{discItem.productName}</span></p>
            <input type="number" min="0" max="100" step="1" value={discVal} onChange={e => setDiscVal(e.target.value)} placeholder="0"
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-lg font-bold font-mono focus:outline-none focus:ring-2 focus:ring-brand mb-3" autoFocus />
            <div className="flex gap-2">
              <button type="button" onClick={() => setDiscItem(null)} className="flex-1 py-2 bg-surface text-muted font-semibold text-xs rounded-lg border border-border">Cancel</button>
              <button type="submit" className="flex-1 py-2 bg-brand text-brand-foreground font-semibold text-xs rounded-lg shadow-md">Apply %</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
