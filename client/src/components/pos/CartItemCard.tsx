import { useState } from 'react';
import { Minus, Plus, Trash2, ChevronDown } from 'lucide-react';
import type { CartItem } from '../../types/pos';

interface Props {
  index: number;
  item: CartItem;
  /** Absolute new quantity, not a delta. The panel converts for the App handler. */
  onUpdateQuantity: (variantId: string, newQuantity: number) => void;
  onUpdateDiscount?: (variantId: string, discountPercent: number) => void;
  onRemoveItem: (variantId: string) => void;
}

/**
 * One cart line. Collapsed it is a scannable row (index, name, line total);
 * tapping it opens the quantity and per-item discount controls, so the dense
 * list stays readable while a cashier is ringing items through quickly.
 */
export function CartItemCard({
  index,
  item,
  onUpdateQuantity,
  onUpdateDiscount,
  onRemoveItem,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);

  const discountPercent = item.discount || 0;
  const effectiveUnitPrice = item.unitPrice * (1 - discountPercent / 100);
  const lineTotal = effectiveUnitPrice * item.quantity;
  const overStock = item.quantity > item.variant.stockQuantity;

  const setQuantity = (next: number) => {
    if (!Number.isFinite(next)) return;
    onUpdateQuantity(item.variant.id, Math.max(1, Math.floor(next)));
  };

  const setDiscount = (raw: string) => {
    if (!onUpdateDiscount) return;
    const parsed = raw === '' ? 0 : parseFloat(raw);
    onUpdateDiscount(item.variant.id, isNaN(parsed) ? 0 : Math.min(100, Math.max(0, parsed)));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onClick={() => setIsExpanded((open) => !open)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setIsExpanded((open) => !open);
        }
      }}
      className={`rounded-xl p-2.5 border cursor-pointer transition-colors ${
        isExpanded
          ? 'bg-card border-success ring-1 ring-success shadow-md'
          : 'bg-surface border-border hover:border-muted/40'
      }`}
    >
      {/* Collapsed row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-[10px] font-mono text-muted w-4 shrink-0 mt-0.5">{index + 1}</span>
          <div className="min-w-0">
            <h4 className="font-bold text-[11px] leading-tight line-clamp-1">{item.productName}</h4>
            <p className="text-[9px] text-muted font-mono mt-0.5 line-clamp-1">
              {item.variantName || item.variant.name || item.variant.sku}
            </p>
            <p className="text-[9px] text-muted mt-0.5">
              {item.quantity} &times; ${effectiveUnitPrice.toFixed(2)}
              {discountPercent > 0 && (
                <span className="ml-1 text-amber-500 font-semibold">-{discountPercent}%</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="font-bold text-[11px] font-mono">${lineTotal.toFixed(2)}</span>
          <ChevronDown
            className={`w-3 h-3 text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          />
          <button
            type="button"
            title="Remove item"
            aria-label={`Remove ${item.productName}`}
            onClick={(e) => {
              e.stopPropagation();
              onRemoveItem(item.variant.id);
            }}
            className="text-muted hover:text-danger p-0.5 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {overStock && (
        <p className="text-[9px] text-danger font-semibold mt-1.5">
          Only {item.variant.stockQuantity} in stock — checkout will be rejected.
        </p>
      )}

      {/* Expanded controls. Clicks inside must not collapse the card. */}
      {isExpanded && (
        <div
          className="mt-2.5 pt-2.5 border-t border-border flex gap-2.5"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="flex-1">
            <label className="text-[10px] font-semibold text-muted mb-1 block">Quantity</label>
            <div className="flex items-center h-8 rounded-lg border border-border bg-card overflow-hidden">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQuantity(item.quantity - 1)}
                disabled={item.quantity <= 1}
                className="px-2 h-full border-r border-border text-muted hover:text-foreground hover:bg-surface disabled:opacity-30 transition"
              >
                <Minus className="w-3 h-3" />
              </button>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={item.quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value, 10))}
                aria-label="Quantity"
                className="w-full h-full text-center text-[11px] font-bold font-mono bg-transparent focus:outline-none focus:ring-1 focus:ring-success"
              />
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQuantity(item.quantity + 1)}
                className="px-2 h-full border-l border-border text-muted hover:text-foreground hover:bg-surface transition"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="flex-1">
            <label className="text-[10px] font-semibold text-muted mb-1 block">Discount (%)</label>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              inputMode="decimal"
              placeholder="0"
              disabled={!onUpdateDiscount}
              value={discountPercent > 0 ? discountPercent : ''}
              onChange={(e) => setDiscount(e.target.value)}
              className="w-full h-8 px-2.5 rounded-lg border border-border bg-card text-[11px] font-bold font-mono focus:outline-none focus:ring-1 focus:ring-success focus:border-success disabled:opacity-40"
            />
          </div>
        </div>
      )}
    </div>
  );
}
