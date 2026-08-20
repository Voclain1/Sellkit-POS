import { useState, useEffect, useRef } from 'react';
import { Search, Barcode, AlertTriangle, Filter, Plus, Camera } from 'lucide-react';
import type { Category, ProductVariant, ScanResult } from '../../types/pos';
import { useHardwareScanner } from '../../hooks/useHardwareScanner';

interface Props {
  categories: Category[];
  variants: ProductVariant[];
  onAddToCart: (v: ProductVariant) => ScanResult;
  /** Resolves ok when the code matched a product and was added to the cart. */
  onScanBarcode: (code: string) => Promise<ScanResult>;
  /** Opens the camera scanner overlay (F1, or the scanner button). */
  onOpenScanner: () => void;
  /** False while a modal owns the till, so scans cannot alter a cart mid-payment. */
  scannerEnabled?: boolean;
  /** Units of each variant already in the cart, keyed by variant id. */
  cartQuantities?: Record<string, number>;
}

/** At or below this many units the card warns instead of just showing a count. */
const LOW_STOCK_THRESHOLD = 10;

export function ProductGrid({
  categories,
  variants,
  onAddToCart,
  onScanBarcode,
  onOpenScanner,
  scannerEnabled = true,
  cartQuantities = {},
}: Props) {
  const [query, setQuery] = useState('');
  const [catId, setCatId] = useState('all');
  const [scanNotice, setScanNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flashNotice = (message: string) => {
    setScanNotice(message);
    clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setScanNotice(''), 2000);
  };

  useEffect(() => () => clearTimeout(noticeTimerRef.current), []);

  const submitCode = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const result = await onScanBarcode(trimmed);
    if (result.ok) {
      setQuery('');
      flashNotice('');
    } else {
      flashNotice(result.message ?? `No product matches "${trimmed}"`);
    }
  };

  // USB/Bluetooth scanners present as keyboards; the hook buffers their bursts.
  const submitCodeRef = useRef(submitCode);
  submitCodeRef.current = submitCode;
  useHardwareScanner({
    enabled: scannerEnabled,
    onScan: (code) => void submitCodeRef.current(code),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        onOpenScanner();
      } else if (e.key === 'F3') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenScanner]);

  const filtered = variants.filter(v => {
    if (catId !== 'all' && v.product?.categoryId !== catId) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (v.product?.name ?? '').toLowerCase().includes(q)
      || (v.name ?? '').toLowerCase().includes(q)
      || v.sku.toLowerCase().includes(q)
      || (v.barcode ?? '').toLowerCase().includes(q);
  });

  return (
    <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden select-none min-w-0">
      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              // A scanner aimed at the search box lands here. So does a cashier
              // typing a code or a name: if the filter has narrowed to exactly one
              // product, Enter rings it up; otherwise treat the text as a code.
              if (filtered.length === 1) {
                const result = onAddToCart(filtered[0]);
                if (result.ok) setQuery('');
                else flashNotice(result.message ?? 'Cannot add that item');
                return;
              }
              void submitCode(query);
            }}
            placeholder="Search or scan — press Enter to add (F3)"
            className="field pl-9 pr-14 py-2.5 text-sm font-medium" />
          <kbd className="kbd absolute right-3 top-1/2 -translate-y-1/2">F3</kbd>
        </div>
        <button
          onClick={onOpenScanner}
          title={scanNotice || 'Scan with the camera (F1)'}
          className={`${scanNotice ? 'btn-danger' : 'btn-quiet'} px-3 text-[11px] shrink-0`}
        >
          {scanNotice ? (
            <Barcode className="w-4 h-4 text-danger" />
          ) : (
            <Camera className="w-4 h-4 text-brand" />
          )}
          <span className="hidden md:inline max-w-[220px] truncate">{scanNotice || 'Scan'}</span>
          {!scanNotice && (
            <kbd className="kbd hidden md:inline">F1</kbd>
          )}
        </button>
      </div>

      {/* Category pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {[{ id: 'all', name: 'All', count: variants.length }, ...categories.map(c => ({
          id: c.id,
          name: c.name,
          count: variants.filter(v => v.product?.categoryId === c.id).length,
        }))].map(c => (
          <button key={c.id} onClick={() => setCatId(c.id)}
            className={`${catId === c.id ? 'btn-primary' : 'btn-quiet'} px-3 py-1.5 rounded-lg text-[11px] whitespace-nowrap`}>
            {c.name}
            <span className={`num text-[10px] ${catId === c.id ? 'text-brand-foreground/70' : 'text-muted'}`}>{c.count}</span>
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted py-16">
            <div className="w-12 h-12 rounded-2xl bg-surface ring-1 ring-inset ring-border flex items-center justify-center mb-3">
              <Filter className="w-5 h-5 stroke-[1.5]" />
            </div>
            <p className="font-semibold text-sm text-foreground">No products found</p>
            <span className="micro-label mt-1">Try another search or category</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {filtered.map(v => {
              // What is left on the shelf once the open cart is accounted for —
              // the number that decides whether one more tap is allowed.
              const available = v.stockQuantity - (cartQuantities[v.id] ?? 0);
              const out = available <= 0;
              const low = !out && available <= LOW_STOCK_THRESHOLD;
              return (
                <button key={v.id} onClick={() => { if (!out) onAddToCart(v); }} disabled={out}
                  title={out ? 'Out of stock' : undefined}
                  className={`group flex flex-col justify-between p-3 bg-card border rounded-2xl text-left shadow-[var(--shadow-raised)] transition duration-150 hover:-translate-y-px active:scale-[0.98] active:translate-y-0 ${out ? 'opacity-40 cursor-not-allowed border-border' : low ? 'border-warning/30 hover:border-warning/60' : 'border-border hover:border-brand/50'}`}>
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span className="num text-[9px] font-medium text-muted bg-surface px-1.5 py-0.5 rounded ring-1 ring-inset ring-border truncate">{v.sku}</span>
                    {out ? <span className="pill-danger px-1.5 py-0 text-[9px] shrink-0">Out</span>
                     : low ? <span className="pill-warning px-1.5 py-0 text-[9px] gap-0.5 shrink-0"><AlertTriangle className="w-2.5 h-2.5" /><span className="num">{available}</span></span>
                     : null}
                  </div>
                  <div className="min-h-[32px]">
                    <h3 className="font-semibold text-xs leading-tight line-clamp-2 group-hover:text-brand transition-colors">{v.product?.name ?? 'Product'}</h3>
                    <span className="text-[10px] text-muted">{v.name && v.name !== 'Standard' ? v.name : v.product?.category?.name ?? ''}</span>
                  </div>
                  <span className={`mt-1 text-[10px] font-medium ${out ? 'text-danger' : low ? 'text-warning' : 'text-muted'}`}>
                    {out ? 'Out of stock' : low ? <>Low stock — <span className="num">{available}</span> left</> : <><span className="num">{available}</span> in stock</>}
                  </span>
                  <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
                    <span className="num-display text-base">${Number(v.price).toFixed(2)}</span>
                    <div className="w-6 h-6 rounded-lg bg-brand/10 text-brand ring-1 ring-inset ring-brand/20 group-hover:bg-brand group-hover:text-brand-foreground group-hover:ring-brand flex items-center justify-center transition">
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
