import { useState, useEffect, useRef } from 'react';
import { Search, Barcode, AlertTriangle, Filter, Plus } from 'lucide-react';
import type { Category, ProductVariant } from '../../types/pos';

interface Props {
  categories: Category[];
  variants: ProductVariant[];
  onAddToCart: (v: ProductVariant) => void;
  /** Resolves true when the code matched a product and was added to the cart. */
  onScanBarcode: (code: string) => Promise<boolean>;
}

/**
 * Longest gap between keystrokes still treated as one scan. A hardware scanner
 * bursts in ~10-30ms; this is loose enough that a human typing a code by hand
 * (or a test dispatching synthetic events) is not silently discarded.
 */
const SCAN_KEY_GAP_MS = 500;
/** How stale the buffer may be when Enter arrives, so an old buffer cannot fire a phantom scan. */
const SCAN_COMMIT_WINDOW_MS = 2000;

export function ProductGrid({ categories, variants, onAddToCart, onScanBarcode }: Props) {
  const [query, setQuery] = useState('');
  const [catId, setCatId] = useState('all');
  const [scanNotice, setScanNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const bufRef = useRef('');
  const lastKeyRef = useRef(0);
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
    const matched = await onScanBarcode(trimmed);
    if (matched) {
      setQuery('');
      flashNotice('');
    } else {
      flashNotice(`No product matches "${trimmed}"`);
    }
  };

  // Keep the listener stable while still calling the latest handler.
  const submitCodeRef = useRef(submitCode);
  submitCodeRef.current = submitCode;

  // Hardware scanners type into whatever has focus, so listen at the window for
  // burst input and let the search field handle its own Enter (below). Previously
  // an Enter in the search box did nothing at all, and the buffer was wiped 200ms
  // after the last keystroke, which discarded anything typed at human speed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); inputRef.current?.focus(); return; }
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const now = Date.now();

      if (e.key.length === 1) {
        if (now - lastKeyRef.current > SCAN_KEY_GAP_MS) bufRef.current = '';
        lastKeyRef.current = now;
        bufRef.current += e.key;
        return;
      }

      if (e.key === 'Enter') {
        const code = bufRef.current;
        bufRef.current = '';
        if (code.length >= 3 && now - lastKeyRef.current <= SCAN_COMMIT_WINDOW_MS) {
          e.preventDefault();
          void submitCodeRef.current(code);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
                onAddToCart(filtered[0]);
                setQuery('');
                return;
              }
              void submitCode(query);
            }}
            placeholder="Search or scan — press Enter to add (F1)"
            className="w-full pl-9 pr-14 py-2.5 bg-surface border border-border rounded-xl text-sm font-medium placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand" />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 bg-border/60 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-muted">F1</kbd>
        </div>
        <div
          className={`flex items-center gap-1.5 px-3 border rounded-xl text-[11px] font-semibold shrink-0 transition ${
            scanNotice
              ? 'bg-danger/10 border-danger/30 text-danger'
              : 'bg-surface border-border text-muted'
          }`}
          title={scanNotice || 'Barcode scanner ready'}
        >
          <Barcode className={`w-4 h-4 ${scanNotice ? 'text-danger' : 'text-brand animate-pulse'}`} />
          <span className="hidden md:inline max-w-[220px] truncate">{scanNotice || 'Scanner'}</span>
        </div>
      </div>

      {/* Category pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button onClick={() => setCatId('all')}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap border transition ${catId === 'all' ? 'bg-brand text-brand-foreground border-brand shadow-md shadow-brand/20' : 'bg-surface text-muted border-border hover:bg-surface/80'}`}>
          All ({variants.length})
        </button>
        {categories.map(c => {
          const n = variants.filter(v => v.product?.categoryId === c.id).length;
          return (
            <button key={c.id} onClick={() => setCatId(c.id)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap border transition ${catId === c.id ? 'bg-brand text-brand-foreground border-brand shadow-md shadow-brand/20' : 'bg-surface text-muted border-border hover:bg-surface/80'}`}>
              {c.name} ({n})
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted py-16">
            <Filter className="w-10 h-10 mb-2 stroke-[1.5]" />
            <p className="font-semibold text-sm">No products found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {filtered.map(v => {
              const low = v.stockQuantity <= 10;
              const out = v.stockQuantity <= 0;
              return (
                <button key={v.id} onClick={() => !out && onAddToCart(v)} disabled={out}
                  className={`group flex flex-col justify-between p-3 bg-card border rounded-xl text-left transition active:scale-[0.97] ${out ? 'opacity-40 cursor-not-allowed border-border' : low ? 'border-amber-500/40 hover:border-amber-500' : 'border-border hover:border-brand/60'}`}>
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span className="text-[9px] font-bold font-mono text-muted bg-surface px-1.5 py-0.5 rounded border border-border truncate">{v.sku}</span>
                    {out ? <span className="bg-danger/15 text-danger text-[9px] font-bold px-1.5 py-0.5 rounded border border-danger/25 shrink-0">OUT</span>
                     : low ? <span className="bg-amber-500/15 text-amber-500 text-[9px] font-bold px-1.5 py-0.5 rounded border border-amber-500/25 flex items-center gap-0.5 shrink-0"><AlertTriangle className="w-2.5 h-2.5" />{v.stockQuantity}</span>
                     : null}
                  </div>
                  <div className="min-h-[32px]">
                    <h3 className="font-bold text-xs leading-tight line-clamp-2 group-hover:text-brand transition">{v.product?.name ?? 'Product'}</h3>
                    <span className="text-[10px] text-muted">{v.name && v.name !== 'Standard' ? v.name : v.product?.category?.name ?? ''}</span>
                  </div>
                  <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
                    <span className="text-sm font-extrabold font-mono text-success">${Number(v.price).toFixed(2)}</span>
                    <div className="w-6 h-6 rounded-md bg-brand/10 text-brand group-hover:bg-brand group-hover:text-brand-foreground flex items-center justify-center transition">
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
