import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  Plus,
  PackagePlus,
  Pencil,
  RefreshCw,
  Loader2,
  AlertTriangle,
  X,
  Boxes,
} from 'lucide-react';
import { apiFetch, ApiError } from '../../lib/api';
import { money, count } from '../../lib/format';
import type { Category, InventoryRow, Product, ProductVariant } from '../../types/pos';

/** Units at or below which a shelf is flagged. Matches the server default. */
const LOW_STOCK_THRESHOLD = 10;

const errorText = (err: unknown, fallback: string): string => {
  if (err instanceof ApiError && err.status === 0) {
    return 'No connection — inventory changes need the server. Try again once you are back online.';
  }
  return err instanceof Error ? err.message : fallback;
};

/** Flatten products into one row per variant: stock lives on the variant, not the product. */
const toRows = (products: Product[]): InventoryRow[] =>
  products.flatMap((product) =>
    (product.variants ?? []).map((variant) => ({ variant, product }))
  );

// ---------------------------------------------------------------------------
// Re-stock dialog
// ---------------------------------------------------------------------------

interface RestockModalProps {
  row: InventoryRow;
  onClose: () => void;
  onSaved: (variant: ProductVariant) => void;
}

function RestockModal({ row, onClose, onSaved }: RestockModalProps) {
  const [mode, setMode] = useState<'delta' | 'absolute'>('delta');
  const [value, setValue] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(value);
  const isValid = value.trim() !== '' && Number.isInteger(parsed);
  const projected = mode === 'delta' ? row.variant.stockQuantity + parsed : parsed;

  const submit = async () => {
    if (!isValid || isSaving) return;
    if (projected < 0) {
      setError('That would take the shelf below zero.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      // Deliveries go through `delta` so a concurrent sale is not overwritten by
      // a count that was already stale when the operator started typing.
      const updated: ProductVariant = await apiFetch(
        `/products/variants/${row.variant.id}/stock`,
        {
          method: 'PATCH',
          body: JSON.stringify(mode === 'delta' ? { delta: parsed } : { stockQuantity: parsed }),
        }
      );
      onSaved(updated);
    } catch (err) {
      setError(errorText(err, 'Failed to update stock'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="w-full max-w-sm panel p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-base tracking-tight truncate">Re-stock</h3>
            <p className="text-xs text-muted truncate">
              {row.product.name}
              {row.variant.name ? ` · ${row.variant.name}` : ''}
            </p>
            <p className="text-[11px] num text-muted">{row.variant.sku}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-surface border border-border rounded-xl p-3 flex items-center justify-between">
          <span className="micro-label">
            On shelf
          </span>
          <span className="num-display text-lg">
            {count(row.variant.stockQuantity)}
          </span>
        </div>

        <div className="flex bg-surface border border-border rounded-xl p-1">
          {(
            [
              { value: 'delta', label: 'Add units' },
              { value: 'absolute', label: 'Set count' },
            ] as const
          ).map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition duration-150 active:scale-[0.97] ${
                mode === m.value
                  ? 'bg-brand text-brand-foreground shadow-[var(--shadow-press)]'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div>
          <label className="micro-label block mb-1">
            {mode === 'delta' ? 'Units received (negative to write off)' : 'Counted quantity'}
          </label>
          <input
            type="number"
            step={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder={mode === 'delta' ? 'e.g. 24' : `${row.variant.stockQuantity}`}
            className="field num px-3 py-2 text-sm font-semibold"
            autoFocus
          />
          {isValid && (
            <p className="text-[11px] text-muted mt-1.5">
              New shelf count:{' '}
              <span className={`num font-semibold ${projected < 0 ? 'text-danger' : 'text-success'}`}>
                {count(projected)}
              </span>
            </p>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 p-2.5 bg-danger/10 border border-danger/25 rounded-xl text-danger text-[11px] font-semibold">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="btn-quiet flex-1 py-2.5 text-xs"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={!isValid || isSaving || projected < 0}
            className="btn-primary flex-1 py-2.5 text-xs"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / edit product dialog
// ---------------------------------------------------------------------------

interface ProductFormModalProps {
  /** Null for a new product; a row puts the form in edit mode for that variant. */
  row: InventoryRow | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}

function ProductFormModal({ row, categories, onClose, onSaved }: ProductFormModalProps) {
  const isEdit = row !== null;

  const [name, setName] = useState<string>(row?.product.name ?? '');
  const [description, setDescription] = useState<string>(row?.product.description ?? '');
  const [categoryId, setCategoryId] = useState<string>(
    row?.product.categoryId ?? categories[0]?.id ?? ''
  );
  const [variantName, setVariantName] = useState<string>(row?.variant.name ?? '');
  const [sku, setSku] = useState<string>(row?.variant.sku ?? '');
  const [barcode, setBarcode] = useState<string>(row?.variant.barcode ?? '');
  const [price, setPrice] = useState<string>(
    row ? String(Number(row.variant.price)) : ''
  );
  const [cost, setCost] = useState<string>(row ? String(Number(row.variant.cost)) : '');
  const [stockQuantity, setStockQuantity] = useState<string>(
    row ? String(row.variant.stockQuantity) : '0'
  );

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const priceNum = Number(price);
  const costNum = Number(cost);
  const canSave =
    name.trim() !== '' &&
    categoryId !== '' &&
    price.trim() !== '' &&
    cost.trim() !== '' &&
    Number.isFinite(priceNum) &&
    priceNum >= 0 &&
    Number.isFinite(costNum) &&
    costNum >= 0;

  const margin = priceNum > 0 && Number.isFinite(costNum) ? ((priceNum - costNum) / priceNum) * 100 : null;

  const submit = async () => {
    if (!canSave || isSaving) return;
    setIsSaving(true);
    setError(null);

    try {
      if (isEdit && row) {
        // Two writes: the product identity, then the variant's pricing. Stock is
        // deliberately untouched here — it only moves through Re-stock.
        await apiFetch(`/products/${row.product.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            categoryId,
          }),
        });
        await apiFetch(`/products/variants/${row.variant.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: variantName.trim() || null,
            sku: sku.trim() || undefined,
            barcode: barcode.trim() || null,
            price: priceNum,
            cost: costNum,
          }),
        });
      } else {
        await apiFetch('/products', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            categoryId,
            variants: [
              {
                name: variantName.trim() || 'Standard',
                sku: sku.trim() || undefined,
                barcode: barcode.trim() || null,
                price: priceNum,
                cost: costNum,
                stockQuantity: Number.isInteger(Number(stockQuantity))
                  ? Number(stockQuantity)
                  : 0,
              },
            ],
          }),
        });
      }
      onSaved();
    } catch (err) {
      setError(errorText(err, 'Failed to save product'));
    } finally {
      setIsSaving(false);
    }
  };

  const field = 'field px-3 py-2 text-sm font-medium';
  const label = 'micro-label block mb-1';

  return (
    <div className="modal-overlay">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base tracking-tight">{isEdit ? 'Edit Product' : 'Add Product'}</h3>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={label}>Product name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Espresso Beans 1kg"
              className={field}
              autoFocus
            />
          </div>

          <div className="sm:col-span-2">
            <label className={label}>Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              className={field}
            />
          </div>

          <div>
            <label className={label}>Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={field}
            >
              {categories.length === 0 && <option value="">No categories yet</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>Variant</label>
            <input
              value={variantName}
              onChange={(e) => setVariantName(e.target.value)}
              placeholder="Standard"
              className={field}
            />
          </div>

          <div>
            <label className={label}>SKU</label>
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder={isEdit ? '' : 'Auto-generated if blank'}
              className={`${field} num`}
            />
          </div>

          <div>
            <label className={label}>Barcode</label>
            <input
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Optional"
              className={`${field} num`}
            />
          </div>

          <div>
            <label className={label}>Cost price</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0.00"
              className={`${field} num`}
            />
          </div>

          <div>
            <label className={label}>Retail price</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className={`${field} num`}
            />
          </div>

          {!isEdit && (
            <div className="sm:col-span-2">
              <label className={label}>Opening stock</label>
              <input
                type="number"
                step={1}
                min="0"
                value={stockQuantity}
                onChange={(e) => setStockQuantity(e.target.value)}
                className={`${field} num`}
              />
            </div>
          )}
        </div>

        {margin !== null && (
          <p className="text-[11px] text-muted">
            Margin:{' '}
            <span className={`num font-semibold ${margin < 0 ? 'text-danger' : 'text-success'}`}>
              {margin.toFixed(1)}%
            </span>{' '}
            ({money(priceNum - costNum)} per unit)
          </p>
        )}

        {isEdit && (
          <p className="text-[11px] text-muted">
            Stock is not editable here — use <span className="font-bold">Re-stock</span> so shelf
            counts always carry an explicit adjustment.
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 p-2.5 bg-danger/10 border border-danger/25 rounded-xl text-danger text-[11px] font-semibold">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="btn-quiet flex-1 py-2.5 text-xs"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={!canSave || isSaving}
            className="btn-primary flex-1 py-2.5 text-xs"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {isEdit ? 'Save changes' : 'Create product'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inventory table
// ---------------------------------------------------------------------------

interface Props {
  /** Open with the low-stock filter already applied (set from the analytics card). */
  initialLowStockOnly?: boolean;
  /** Let the POS catalog pick up stock and price changes made here. */
  onCatalogChanged?: () => void;
}

export function InventoryManager({ initialLowStockOnly = false, onCatalogChanged }: Props) {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [lowStockOnly, setLowStockOnly] = useState<boolean>(initialLowStockOnly);

  const [restockRow, setRestockRow] = useState<InventoryRow | null>(null);
  const [formRow, setFormRow] = useState<InventoryRow | null>(null);
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [products, cats] = await Promise.all([
        apiFetch('/products') as Promise<Product[]>,
        apiFetch('/products/categories') as Promise<Category[]>,
      ]);
      setRows(toRows(products));
      setCategories(cats);
    } catch (err) {
      setError(errorText(err, 'Failed to load inventory'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Reflect the filter the caller asked for when it changes (e.g. the operator
  // clicks the low-stock card while already sitting on this view).
  useEffect(() => {
    setLowStockOnly(initialLowStockOnly);
  }, [initialLowStockOnly]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => categoryFilter === 'all' || r.product.categoryId === categoryFilter)
      .filter((r) => !lowStockOnly || r.variant.stockQuantity <= LOW_STOCK_THRESHOLD)
      .filter(
        (r) =>
          q === '' ||
          r.product.name.toLowerCase().includes(q) ||
          r.variant.sku.toLowerCase().includes(q) ||
          (r.variant.barcode ?? '').toLowerCase().includes(q) ||
          (r.variant.name ?? '').toLowerCase().includes(q)
      )
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
  }, [rows, query, categoryFilter, lowStockOnly]);

  const lowStockCount = useMemo(
    () => rows.filter((r) => r.variant.stockQuantity <= LOW_STOCK_THRESHOLD).length,
    [rows]
  );

  const stockOnHandValue = useMemo(
    () => rows.reduce((sum, r) => sum + Number(r.variant.cost) * r.variant.stockQuantity, 0),
    [rows]
  );

  /** Patch one variant in place so the table updates without a full refetch. */
  const applyVariantUpdate = (updated: ProductVariant) => {
    setRows((prev) =>
      prev.map((r) =>
        r.variant.id === updated.id ? { ...r, variant: { ...r.variant, ...updated } } : r
      )
    );
    onCatalogChanged?.();
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Inventory</h2>
          <p className="text-xs text-muted">
            {count(rows.length)} variants · {money(stockOnHandValue)} at cost on hand
            {lowStockCount > 0 && (
              <>
                {' · '}
                <span className="text-danger font-semibold">{count(lowStockCount)} low</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={isLoading}
            className="btn-quiet p-2"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => {
              setFormRow(null);
              setIsFormOpen(true);
            }}
            className="btn-primary px-3 py-2 text-xs"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, SKU, or barcode…"
            className="field pl-9 pr-4 py-2 text-sm font-medium"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="field px-3 py-2 text-xs font-semibold"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setLowStockOnly((v) => !v)}
          className={`px-3 py-2 rounded-xl text-xs font-bold border transition ${
            lowStockOnly
              ? 'bg-danger/10 text-danger border-danger/30'
              : 'bg-surface text-muted border-border hover:text-foreground'
          }`}
        >
          Low stock only
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-danger/10 border border-danger/25 rounded-xl text-danger text-xs font-semibold">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Table */}
      <div className="panel overflow-hidden">
        {isLoading && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-20 text-muted text-sm">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading inventory…
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="py-20 text-center text-xs text-muted flex flex-col items-center gap-2">
            <Boxes className="w-6 h-6" />
            {rows.length === 0 ? 'No products yet.' : 'Nothing matches these filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface text-muted uppercase text-[10px] tracking-widest">
                <tr>
                  <th className="px-4 py-2.5 font-bold">SKU</th>
                  <th className="px-4 py-2.5 font-bold">Product</th>
                  <th className="px-4 py-2.5 font-bold">Category</th>
                  <th className="px-4 py-2.5 font-bold text-right">Stock</th>
                  <th className="px-4 py-2.5 font-bold text-right">Cost</th>
                  <th className="px-4 py-2.5 font-bold text-right">Retail</th>
                  <th className="px-4 py-2.5 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleRows.map((row) => {
                  const stock = row.variant.stockQuantity;
                  const stockTone =
                    stock <= 0
                      ? 'bg-danger/10 text-danger ring-danger/25'
                      : stock <= LOW_STOCK_THRESHOLD
                        ? 'bg-warning/10 text-warning ring-warning/25'
                        : 'bg-success/10 text-success ring-success/25';

                  return (
                    <tr key={row.variant.id} className="hover:bg-surface/60 transition">
                      <td className="px-4 py-2.5 num text-muted whitespace-nowrap">
                        {row.variant.sku}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-bold block">{row.product.name}</span>
                        {row.variant.name && (
                          <span className="text-[10px] text-muted">{row.variant.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted whitespace-nowrap">
                        {row.product.category?.name ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full ring-1 ring-inset num font-semibold ${stockTone}`}
                        >
                          {count(stock)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right num text-muted">
                        {money(row.variant.cost)}
                      </td>
                      <td className="px-4 py-2.5 text-right num font-semibold">
                        {money(row.variant.price)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setRestockRow(row)}
                            className="flex items-center gap-1 px-2 py-1 bg-brand/10 text-brand border border-brand/25 rounded-lg text-[11px] font-bold transition hover:bg-brand/20"
                            title="Re-stock this variant"
                          >
                            <PackagePlus className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Re-stock</span>
                          </button>
                          <button
                            onClick={() => {
                              setFormRow(row);
                              setIsFormOpen(true);
                            }}
                            className="p-1.5 bg-surface border border-border rounded-lg text-muted hover:text-foreground transition"
                            title="Edit product"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {restockRow && (
        <RestockModal
          row={restockRow}
          onClose={() => setRestockRow(null)}
          onSaved={(variant) => {
            applyVariantUpdate(variant);
            setRestockRow(null);
          }}
        />
      )}

      {isFormOpen && (
        <ProductFormModal
          row={formRow}
          categories={categories}
          onClose={() => setIsFormOpen(false)}
          onSaved={() => {
            setIsFormOpen(false);
            void load();
            onCatalogChanged?.();
          }}
        />
      )}
    </div>
  );
}
