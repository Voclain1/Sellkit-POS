import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  DollarSign,
  Receipt,
  TrendingUp,
  PackageX,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Trophy,
} from 'lucide-react';
import { apiFetch, ApiError } from '../../lib/api';
import { money, count, shortDay } from '../../lib/format';
import type { AnalyticsDashboardData, AnalyticsRange } from '../../types/pos';

const RANGE_LABELS: { value: AnalyticsRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 Days' },
  { value: 'mtd', label: 'Month to Date' },
];

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'brand' | 'success' | 'accent' | 'danger';
}

function StatCard({ icon, label, value, hint, tone = 'brand' }: StatCardProps) {
  const tones = {
    brand: 'bg-brand/10 text-brand ring-brand/25',
    success: 'bg-success/10 text-success ring-success/25',
    accent: 'bg-accent/10 text-accent ring-accent/25',
    danger: 'bg-danger/10 text-danger ring-danger/25',
  } as const;

  return (
    <div className="panel p-4 flex items-start gap-3 h-full">
      <div className={`w-10 h-10 shrink-0 rounded-xl ring-1 ring-inset flex items-center justify-center ${tones[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <span className="micro-label block">{label}</span>
        <span className="num-display text-2xl block truncate">{value}</span>
        {hint && <span className="text-[11px] text-muted block truncate">{hint}</span>}
      </div>
    </div>
  );
}

interface Props {
  /** Units at or below which a variant counts as low stock. */
  lowStockThreshold?: number;
  /** Jump the operator straight to the low-stock filter in the inventory view. */
  onReviewLowStock?: () => void;
}

export function AnalyticsDashboard({ lowStockThreshold = 10, onReviewLowStock }: Props) {
  const [range, setRange] = useState<AnalyticsRange>('today');
  const [data, setData] = useState<AnalyticsDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const payload: AnalyticsDashboardData = await apiFetch(
        `/analytics/dashboard?range=${range}&lowStockThreshold=${lowStockThreshold}`
      );
      setData(payload);
    } catch (err) {
      // Analytics is a read-only back-office view. An outage here is worth
      // reporting plainly; it must never block the till.
      setError(
        err instanceof ApiError && err.status === 0
          ? 'Analytics needs a connection — this view is not available offline.'
          : err instanceof Error
            ? err.message
            : 'Failed to load analytics'
      );
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [range, lowStockThreshold]);

  useEffect(() => {
    void load();
  }, [load]);

  const peakRevenue = data ? Math.max(0, ...data.trend.map((t) => t.revenue)) : 0;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Range filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Analytics</h2>
          <p className="text-xs text-muted">
            {data
              ? `${new Date(data.periodStart).toLocaleString()} — now`
              : 'Historical trading performance'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-surface border border-border rounded-xl p-1">
            {RANGE_LABELS.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition duration-150 active:scale-[0.97] ${
                  range === r.value
                    ? 'bg-brand text-brand-foreground shadow-[var(--shadow-press)]'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => void load()}
            disabled={isLoading}
            className="btn-quiet p-2"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-danger/10 border border-danger/25 rounded-xl text-danger text-xs font-semibold">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {isLoading && !data ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted text-sm">
          <Loader2 className="w-5 h-5 animate-spin" />
          Crunching the numbers…
        </div>
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <StatCard
              icon={<DollarSign className="w-5 h-5" />}
              label="Total Revenue"
              value={money(data.totalRevenue)}
              hint={RANGE_LABELS.find((r) => r.value === data.range)?.label}
              tone="success"
            />
            <StatCard
              icon={<Receipt className="w-5 h-5" />}
              label="Total Orders"
              value={count(data.totalOrders)}
              hint={data.totalOrders === 1 ? '1 receipt' : `${count(data.totalOrders)} receipts`}
              tone="brand"
            />
            <StatCard
              icon={<TrendingUp className="w-5 h-5" />}
              label="Average Order Value"
              value={money(data.averageOrderValue)}
              hint={data.totalOrders === 0 ? 'No sales in this window' : 'Revenue ÷ orders'}
              tone="accent"
            />
            <button
              type="button"
              onClick={onReviewLowStock}
              disabled={!onReviewLowStock}
              className="text-left rounded-2xl transition enabled:hover:opacity-90 disabled:cursor-default"
            >
              <StatCard
                icon={<PackageX className="w-5 h-5" />}
                label="Low Stock Alerts"
                value={count(data.lowStockCount)}
                hint={`At or below ${data.lowStockThreshold} units`}
                tone={data.lowStockCount > 0 ? 'danger' : 'success'}
              />
            </button>
          </div>

          {/* Sales trend */}
          <section className="panel p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm tracking-tight">Sales Trend</h3>
              <span className="text-[11px] text-muted font-semibold">
                Peak day {money(peakRevenue)}
              </span>
            </div>

            {data.trend.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted">No trading days in this window.</p>
            ) : (
              <div className="flex items-end gap-2 sm:gap-3 h-44 overflow-x-auto pb-1">
                {data.trend.map((point) => {
                  // Guard the divide: a window with no sales would size every bar off NaN.
                  const heightPct = peakRevenue > 0 ? (point.revenue / peakRevenue) * 100 : 0;
                  return (
                    <div
                      key={point.date}
                      className="flex-1 min-w-[44px] h-full flex flex-col items-center justify-end gap-1.5 group"
                      title={`${shortDay(point.date)} — ${money(point.revenue)} across ${count(point.orders)} order(s)`}
                    >
                      <span className="text-[10px] font-bold text-muted group-hover:text-foreground transition whitespace-nowrap">
                        {point.revenue > 0 ? money(point.revenue) : '—'}
                      </span>
                      <div
                        className={`w-full rounded-t-lg transition-all ${
                          point.revenue > 0 ? 'bg-brand group-hover:bg-accent' : 'bg-border'
                        }`}
                        style={{ height: `${Math.max(heightPct, point.revenue > 0 ? 4 : 2)}%` }}
                      />
                      <span className="text-[10px] font-semibold text-muted whitespace-nowrap">
                        {shortDay(point.date)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Top sellers */}
          <section className="panel overflow-hidden">
            <div className="flex items-center gap-2 p-4 border-b border-border">
              <Trophy className="w-4 h-4 text-brand" />
              <h3 className="font-semibold text-sm tracking-tight">Top Selling Products</h3>
            </div>

            {data.topProducts.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted">
                Nothing sold in this window yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface text-muted uppercase text-[10px] tracking-widest">
                    <tr>
                      <th className="px-4 py-2.5 font-bold">#</th>
                      <th className="px-4 py-2.5 font-bold">Product</th>
                      <th className="px-4 py-2.5 font-bold">SKU</th>
                      <th className="px-4 py-2.5 font-bold text-right">Units Sold</th>
                      <th className="px-4 py-2.5 font-bold text-right">Revenue</th>
                      <th className="px-4 py-2.5 font-bold text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.topProducts.map((row, idx) => {
                      const share =
                        data.totalRevenue > 0 ? (row.revenue / data.totalRevenue) * 100 : 0;
                      return (
                        <tr key={row.variantId} className="hover:bg-surface/60 transition">
                          <td className="px-4 py-2.5 num text-muted">{idx + 1}</td>
                          <td className="px-4 py-2.5">
                            <span className="font-bold block">{row.productName}</span>
                            <span className="text-[10px] text-muted">
                              {[row.variantName, row.categoryName].filter(Boolean).join(' · ') ||
                                'Standard'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 num text-muted">{row.sku}</td>
                          <td className="px-4 py-2.5 text-right num font-semibold">
                            {count(row.unitsSold)}
                          </td>
                          <td className="px-4 py-2.5 text-right num font-semibold text-success">
                            {money(row.revenue)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 bg-surface rounded-full overflow-hidden hidden sm:block">
                                <div
                                  className="h-full bg-brand rounded-full"
                                  style={{ width: `${Math.min(share, 100)}%` }}
                                />
                              </div>
                              <span className="num text-muted">{share.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
