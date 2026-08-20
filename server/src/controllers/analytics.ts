import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest } from '../middleware/auth';

/** Windows the back office can ask for. Anything else is rejected, not guessed at. */
export type AnalyticsRange = 'today' | '7d' | 'mtd';

const RANGES: AnalyticsRange[] = ['today', '7d', 'mtd'];

const DEFAULT_LOW_STOCK_THRESHOLD = 10;

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Resolve a range name into a half-open [start, end) window.
 *
 * Boundaries are server-local midnights: "today" at the till means the day the
 * shop is trading, not a UTC day that rolls over mid-afternoon.
 */
function resolveWindow(range: AnalyticsRange, now: Date): { start: Date; end: Date } {
  const today = startOfDay(now);

  if (range === 'today') {
    return { start: today, end: now };
  }

  if (range === '7d') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6); // today inclusive => 7 buckets
    return { start, end: now };
  }

  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
}

/** Local YYYY-MM-DD. `toISOString()` would shift the bucket across the date line. */
function dayKey(d: Date): string {
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Every day in the window, so a zero-sales day shows as a gap rather than vanishing. */
function emptyBuckets(start: Date, end: Date): Map<string, { revenue: number; orders: number }> {
  const buckets = new Map<string, { revenue: number; orders: number }>();
  for (const cursor = startOfDay(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    buckets.set(dayKey(cursor), { revenue: 0, orders: 0 });
  }
  return buckets;
}

/**
 * Back-office dashboard figures (/api/analytics/dashboard?range=today|7d|mtd).
 *
 * Headline totals, a per-day trend, and the top sellers for the window — plus the
 * low-stock count, which is deliberately *not* windowed: it is a live shelf state.
 */
export const getDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rangeParam = typeof req.query.range === 'string' ? req.query.range : 'today';
    if (!RANGES.includes(rangeParam as AnalyticsRange)) {
      // A 400 (not a 500) so the client's ApiError marks it permanent and stops retrying.
      res.status(400).json({ error: `Unknown range "${rangeParam}". Expected one of: ${RANGES.join(', ')}` });
      return;
    }
    const range = rangeParam as AnalyticsRange;

    const thresholdRaw = typeof req.query.lowStockThreshold === 'string'
      ? parseInt(req.query.lowStockThreshold, 10)
      : NaN;
    const lowStockThreshold = Number.isFinite(thresholdRaw) && thresholdRaw >= 0
      ? thresholdRaw
      : DEFAULT_LOW_STOCK_THRESHOLD;

    const outletId = typeof req.query.outletId === 'string' ? req.query.outletId : undefined;

    const now = new Date();
    const { start, end } = resolveWindow(range, now);
    const saleWhere = {
      createdAt: { gte: start, lte: end },
      ...(outletId ? { outletId } : {}),
    };

    const [sales, topRows, lowStockCount] = await Promise.all([
      // Bucketing happens here rather than in SQL: a till's daily volume is small,
      // and this keeps the day boundaries on the same clock as resolveWindow().
      prisma.sale.findMany({
        where: saleWhere,
        select: { createdAt: true, totalAmount: true },
      }),
      prisma.saleItem.groupBy({
        by: ['productVariantId'],
        where: { sale: saleWhere },
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { totalPrice: 'desc' } },
        take: 10,
      }),
      prisma.productVariant.count({ where: { stockQuantity: { lte: lowStockThreshold } } }),
    ]);

    const buckets = emptyBuckets(start, end);
    let totalRevenue = 0;
    for (const sale of sales) {
      totalRevenue += Number(sale.totalAmount);
      const bucket = buckets.get(dayKey(sale.createdAt));
      if (bucket) {
        bucket.revenue += Number(sale.totalAmount);
        bucket.orders += 1;
      }
    }

    const totalOrders = sales.length;

    // Name the top sellers. groupBy returns ids only, so resolve them in one query.
    const variants = topRows.length
      ? await prisma.productVariant.findMany({
          where: { id: { in: topRows.map((r) => r.productVariantId) } },
          include: { product: { include: { category: true } } },
        })
      : [];
    const variantById = new Map(variants.map((v) => [v.id, v]));

    const topProducts = topRows.map((row) => {
      const variant = variantById.get(row.productVariantId);
      return {
        variantId: row.productVariantId,
        sku: variant?.sku ?? '—',
        productName: variant?.product?.name ?? 'Deleted product',
        variantName: variant?.name ?? null,
        categoryName: variant?.product?.category?.name ?? null,
        unitsSold: row._sum.quantity ?? 0,
        revenue: Number(row._sum.totalPrice ?? 0),
      };
    });

    res.json({
      range,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      totalRevenue,
      totalOrders,
      averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      lowStockThreshold,
      lowStockCount,
      trend: Array.from(buckets.entries()).map(([date, v]) => ({ date, ...v })),
      topProducts,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to build analytics dashboard', details: error.message });
  }
};
