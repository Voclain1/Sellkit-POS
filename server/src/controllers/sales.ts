import { Response } from 'express';
import { Prisma, PaymentMethod } from '@prisma/client';
import { prisma } from '../prisma';
import { handleError } from '../lib/respond';
import { AuthenticatedRequest } from '../middleware/auth';
import { HttpError, prismaErrorCode } from '../lib/httpError';
import { TAX_RATE } from '../lib/config';

export interface CheckoutItemInput {
  productVariantId: string;
  quantity: number;
  /** List price the till rang the item up at, before any line discount. */
  unitPrice?: number;
  /** Line discount, 0-100. */
  discountPercent?: number;
}

export interface PaymentSplitInput {
  paymentMethod: PaymentMethod;
  amount: number;
}

export interface CheckoutRequestInput {
  outletId: string;
  tillId: string;
  customerId?: string;
  shiftId?: string;
  items: CheckoutItemInput[];
  paymentSplits: PaymentSplitInput[];
  tax?: number;
  discount?: number;
  isOfflineSync?: boolean;
  /** Till-generated id; a replay with the same id returns the original sale. */
  clientSaleId?: string;
  /** When the sale was rung up (ISO 8601). Honoured for offline sales only. */
  soldAt?: string;
  /** Cashier who rang up an offline sale, which may not be who syncs it. */
  soldByUserId?: string;
}

/** Totals are compared to the cent; float noise below that is not a mismatch. */
const MONEY_TOLERANCE = 0.01;
/** A till clock this far ahead of the server is distrusted. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const PAYMENT_METHODS = new Set<string>(Object.values(PaymentMethod));

const saleInclude = {
  saleItems: { include: { productVariant: { include: { product: true } } } },
  paymentSplits: true,
  customer: true,
  user: { select: { id: true, name: true, email: true } },
  outlet: true,
  till: true,
} satisfies Prisma.SaleInclude;

const round2 = (n: number): number => Math.round(n * 100) / 100;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Optional non-negative money field: undefined stays undefined, anything else must be a number >= 0. */
function optionalMoney(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${field} must be a non-negative number`);
  return n;
}

/**
 * When the sale happened. Online sales are stamped by the server. An offline
 * sale keeps the time it was rung up, so it lands in the right shift, Z-report
 * and analytics day rather than whenever the queue drained.
 */
function resolveSoldAt(isOffline: boolean, soldAt: unknown, now: Date): Date {
  if (!isOffline || typeof soldAt !== 'string') return now;
  const parsed = new Date(soldAt);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, 'soldAt must be an ISO 8601 timestamp');
  // A till clock running fast must not put a sale in the future.
  return parsed.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS ? now : parsed;
}

/**
 * POST /api/sales/checkout
 *
 * Online sales are priced by the server: the list price comes from the
 * catalogue and tax from TAX_RATE, and a stale till is told to refresh (409)
 * rather than charging a figure the server does not recognise.
 *
 * Offline sales have already happened -- the customer paid and left -- so
 * rejecting them helps no one. They are accepted at the price the till charged
 * even if stock ran out or the price has since changed, and flagged
 * `needsReview` with the reason so a manager can follow up.
 *
 * Idempotent on `clientSaleId`: a replay returns the original sale with 200.
 */
export const processCheckout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const tokenUserId = req.user?.userId;
  if (!tokenUserId) {
    res.status(401).json({ error: 'Unauthorized: User ID required for checkout' });
    return;
  }

  const body = (req.body ?? {}) as CheckoutRequestInput;
  const clientSaleId = typeof body.clientSaleId === 'string' ? body.clientSaleId.trim() : undefined;

  try {
    if (clientSaleId !== undefined && (clientSaleId.length === 0 || clientSaleId.length > 100)) {
      throw new HttpError(400, 'clientSaleId must be 1-100 characters');
    }

    // Replay of a sale we already recorded: hand back the original.
    if (clientSaleId) {
      const existing = await findReplay(clientSaleId, body.tillId);
      if (existing) {
        res.status(200).json(existing);
        return;
      }
    }

    const sale = await createSale(body, tokenUserId, clientSaleId);
    res.status(201).json(sale);
  } catch (error: unknown) {
    // Two copies of the same sale raced past the replay check; the unique index
    // stopped the second. Return the one that won.
    if (clientSaleId && prismaErrorCode(error) === 'P2002') {
      const existing = await findReplay(clientSaleId, body.tillId).catch(() => null);
      if (existing) {
        res.status(200).json(existing);
        return;
      }
    }

    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message, ...error.details });
      return;
    }

    const code = prismaErrorCode(error);
    if (code === 'P2003') {
      // A foreign key the request named does not exist (customer, user...).
      res.status(400).json({ error: 'Checkout references a record that does not exist' });
      return;
    }

    // Anything else is ours, and possibly transient (connection drop, timeout).
    // 500 tells the offline queue to try again rather than give up on the sale.
    console.error('Checkout failed:', error);
    res.status(500).json({ error: 'Checkout failed due to a server error. It is safe to retry.' });
  }
};

async function findReplay(clientSaleId: string, tillId: unknown) {
  const existing = await prisma.sale.findUnique({ where: { clientSaleId }, include: saleInclude });
  if (existing && typeof tillId === 'string' && existing.tillId !== tillId) {
    throw new HttpError(409, 'clientSaleId already belongs to a sale on another till');
  }
  return existing;
}

async function createSale(body: CheckoutRequestInput, tokenUserId: string, clientSaleId: string | undefined) {
  const { outletId, tillId, customerId, items, paymentSplits } = body;
  const isOffline = body.isOfflineSync === true;

  // ---- Shape checks (400: the payload itself is wrong) ---------------------
  if (typeof outletId !== 'string' || typeof tillId !== 'string') {
    throw new HttpError(400, 'Outlet ID and Till ID are required');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'At least one item is required');
  }
  if (!Array.isArray(paymentSplits) || paymentSplits.length === 0) {
    throw new HttpError(400, 'At least one payment split is required');
  }

  for (const item of items) {
    if (!item || typeof item.productVariantId !== 'string') {
      throw new HttpError(400, 'Every item needs a productVariantId');
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new HttpError(400, 'Item quantities must be whole numbers of at least 1');
    }
    const pct = item.discountPercent ?? 0;
    if (!isFiniteNumber(pct) || pct < 0 || pct > 100) {
      throw new HttpError(400, 'discountPercent must be between 0 and 100');
    }
    optionalMoney(item.unitPrice, 'unitPrice');
  }

  for (const p of paymentSplits) {
    if (!p || !PAYMENT_METHODS.has(p.paymentMethod)) {
      throw new HttpError(400, `paymentMethod must be one of: ${[...PAYMENT_METHODS].join(', ')}`);
    }
    if (!isFiniteNumber(Number(p.amount)) || Number(p.amount) <= 0) {
      throw new HttpError(400, 'Payment amounts must be positive numbers');
    }
  }

  const declaredTax = optionalMoney(body.tax, 'tax');
  const orderDiscount = optionalMoney(body.discount, 'discount') ?? 0;

  const now = new Date();
  const soldAt = resolveSoldAt(isOffline, body.soldAt, now);

  return prisma.$transaction(async (tx) => {
    // ---- Where and who ------------------------------------------------------
    const till = await tx.till.findUnique({ where: { id: tillId } });
    if (!till || till.outletId !== outletId) {
      throw new HttpError(400, 'Till not found for this outlet');
    }

    if (customerId) {
      const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!customer) throw new HttpError(400, 'Customer not found');
    }

    // An offline sale belongs to the cashier who rang it up, who may have
    // signed out before the queue drained. Online, the token is the cashier.
    let userId = tokenUserId;
    if (isOffline && typeof body.soldByUserId === 'string' && body.soldByUserId !== tokenUserId) {
      const seller = await tx.user.findUnique({ where: { id: body.soldByUserId }, select: { id: true } });
      if (seller) userId = seller.id;
    }

    const shiftId = await resolveShiftId(tx, tillId, body.shiftId, soldAt);

    // ---- Pricing ------------------------------------------------------------
    const variantIds = [...new Set(items.map((i) => i.productVariantId))];
    const variants = await tx.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: true },
    });
    const variantById = new Map(variants.map((v) => [v.id, v]));

    const reviewNotes: string[] = [];
    const itemsToCreate: Prisma.SaleItemCreateWithoutSaleInput[] = [];
    const quantityByVariant = new Map<string, number>();
    let subtotal = 0;

    for (const item of items) {
      const variant = variantById.get(item.productVariantId);
      if (!variant) {
        throw new HttpError(400, `Product variant ${item.productVariantId} not found`);
      }
      const label = `${variant.product.name} (${variant.name || 'Default'})`;
      const listPrice = Number(variant.price);
      const tillPrice = item.unitPrice === undefined ? listPrice : Number(item.unitPrice);

      let chargedListPrice = listPrice;
      if (Math.abs(tillPrice - listPrice) > MONEY_TOLERANCE) {
        if (!isOffline) {
          throw new HttpError(
            409,
            `The price of "${label}" has changed to ${listPrice.toFixed(2)}. Refresh the till and try again.`,
            { code: 'PRICE_CHANGED' }
          );
        }
        // Offline the customer already paid the till's price; keep it, flag it.
        chargedListPrice = tillPrice;
        reviewNotes.push(`"${label}" sold at ${tillPrice.toFixed(2)}; catalogue price is ${listPrice.toFixed(2)}`);
      }

      const unitPrice = chargedListPrice * (1 - (item.discountPercent ?? 0) / 100);
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;

      itemsToCreate.push({
        productVariant: { connect: { id: variant.id } },
        quantity: item.quantity,
        unitPrice: round2(unitPrice),
        totalPrice: round2(lineTotal),
      });
      quantityByVariant.set(variant.id, (quantityByVariant.get(variant.id) ?? 0) + item.quantity);
    }

    // Same arithmetic as the till's computeCartTotals(): tax on the discounted
    // subtotal, then the order discount off the taxed total.
    const computedTax = subtotal * TAX_RATE;
    let tax = computedTax;
    if (declaredTax !== undefined && Math.abs(declaredTax - computedTax) > MONEY_TOLERANCE) {
      if (!isOffline) {
        throw new HttpError(
          409,
          `Tax should be ${computedTax.toFixed(2)}, the till sent ${declaredTax.toFixed(2)}. Refresh the till and try again.`,
          { code: 'TAX_CHANGED' }
        );
      }
      tax = declaredTax;
      reviewNotes.push(`Tax charged ${declaredTax.toFixed(2)}; expected ${computedTax.toFixed(2)}`);
    }

    if (orderDiscount > subtotal + tax + MONEY_TOLERANCE) {
      throw new HttpError(400, 'Order discount cannot exceed the order total');
    }

    const totalAmount = Math.max(0, subtotal + tax - orderDiscount);
    const totalPayments = paymentSplits.reduce((sum, p) => sum + Number(p.amount), 0);
    if (Math.abs(totalPayments - totalAmount) > MONEY_TOLERANCE) {
      throw new HttpError(
        isOffline ? 400 : 409,
        `Payments (${totalPayments.toFixed(2)}) do not match the total (${totalAmount.toFixed(2)})`,
        { code: 'TOTAL_MISMATCH' }
      );
    }

    // ---- Stock --------------------------------------------------------------
    for (const [variantId, quantity] of quantityByVariant) {
      const variant = variantById.get(variantId)!;
      const label = `${variant.product.name} (${variant.name || 'Default'})`;

      if (isOffline) {
        // The goods have already left the shop: record it, even below zero.
        const updated = await tx.productVariant.update({
          where: { id: variantId },
          data: { stockQuantity: { decrement: quantity } },
          select: { stockQuantity: true },
        });
        if (updated.stockQuantity < 0) {
          reviewNotes.push(`"${label}" oversold offline; stock is now ${updated.stockQuantity}`);
        }
        continue;
      }

      // Conditional decrement: two tills selling the last unit at once cannot
      // both succeed, because the check and the write are one statement.
      const { count } = await tx.productVariant.updateMany({
        where: { id: variantId, stockQuantity: { gte: quantity } },
        data: { stockQuantity: { decrement: quantity } },
      });
      if (count === 0) {
        const current = await tx.productVariant.findUnique({ where: { id: variantId }, select: { stockQuantity: true } });
        throw new HttpError(
          409,
          `Insufficient stock for "${label}". Available: ${current?.stockQuantity ?? 0}, requested: ${quantity}`,
          { code: 'INSUFFICIENT_STOCK' }
        );
      }
    }

    // ---- Receipt number -----------------------------------------------------
    // Per-till counter bumped inside this transaction: the row lock serialises
    // concurrent sales on one till, and a rollback returns the number, so
    // receipts run sequentially with no gaps or collisions.
    const counter = await tx.till.update({
      where: { id: tillId },
      data: { receiptSeq: { increment: 1 } },
      select: { code: true, receiptSeq: true },
    });
    const receiptNumber = `${counter.code}-${String(counter.receiptSeq).padStart(6, '0')}`;

    const sale = await tx.sale.create({
      data: {
        receiptNumber,
        clientSaleId: clientSaleId ?? null,
        totalAmount: round2(totalAmount),
        tax: round2(tax),
        discount: round2(orderDiscount),
        isOfflineSync: isOffline,
        needsReview: reviewNotes.length > 0,
        reviewNotes: reviewNotes.length > 0 ? reviewNotes.join('\n') : null,
        createdAt: soldAt,
        user: { connect: { id: userId } },
        outlet: { connect: { id: outletId } },
        till: { connect: { id: tillId } },
        ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
        ...(shiftId ? { shift: { connect: { id: shiftId } } } : {}),
        saleItems: { create: itemsToCreate },
        paymentSplits: {
          create: paymentSplits.map((p) => ({ paymentMethod: p.paymentMethod, amount: round2(Number(p.amount)) })),
        },
      },
      include: saleInclude,
    });

    // Loyalty: 1 point per 10 spent.
    if (customerId) {
      const pointsEarned = Math.floor(totalAmount / 10);
      if (pointsEarned > 0) {
        await tx.customer.update({
          where: { id: customerId },
          data: { loyaltyPoints: { increment: pointsEarned } },
        });
      }
    }

    return sale;
  });
}

/**
 * The shift a sale belongs to. The till's own claim wins when it names a shift
 * on this till; otherwise, the shift that was open on the till when the sale
 * happened. Never a reason to reject a sale -- worst case it is left unlinked
 * and falls back to time-window attribution.
 */
async function resolveShiftId(
  tx: Prisma.TransactionClient,
  tillId: string,
  claimed: unknown,
  soldAt: Date
): Promise<string | null> {
  if (typeof claimed === 'string' && claimed) {
    const shift = await tx.tillReconciliation.findUnique({ where: { id: claimed }, select: { tillId: true } });
    if (shift && shift.tillId === tillId) return claimed;
  }

  const shift = await tx.tillReconciliation.findFirst({
    where: {
      tillId,
      openedAt: { lte: soldAt },
      OR: [{ closedAt: null }, { closedAt: { gte: soldAt } }],
    },
    orderBy: { openedAt: 'desc' },
    select: { id: true },
  });
  return shift?.id ?? null;
}

// List Sales History
export const getSales = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const outletId = typeof req.query.outletId === 'string' ? req.query.outletId : undefined;
    const tillId = typeof req.query.tillId === 'string' ? req.query.tillId : undefined;
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined;
    const isOfflineSync = req.query.isOfflineSync !== undefined ? req.query.isOfflineSync === 'true' : undefined;
    const needsReview = req.query.needsReview !== undefined ? req.query.needsReview === 'true' : undefined;
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined;
    const takeRaw = typeof req.query.take === 'string' ? parseInt(req.query.take, 10) : NaN;
    const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 100) : 50;

    const where: Prisma.SaleWhereInput = {};
    if (outletId) where.outletId = outletId;
    if (tillId) where.tillId = tillId;
    if (customerId) where.customerId = customerId;
    if (isOfflineSync !== undefined) where.isOfflineSync = isOfflineSync;
    if (needsReview !== undefined) where.needsReview = needsReview;

    const sales = await prisma.sale.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        customer: true,
        paymentSplits: true,
        saleItems: {
          include: {
            productVariant: {
              include: { product: true },
            },
          },
        },
      },
      // id breaks ties so the cursor is stable when two sales share a timestamp.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    // One extra row tells us whether there is a next page without a count query.
    const hasMore = sales.length > take;
    const page = hasMore ? sales.slice(0, take) : sales;
    res.json({ sales: page, nextCursor: hasMore ? page[page.length - 1].id : null });
  } catch (error: any) {
    handleError(res, error, 'Failed to fetch sales');
  }
};

// Get Single Sale Receipt Details
export const getSaleById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        customer: true,
        outlet: true,
        till: true,
        paymentSplits: true,
        saleItems: {
          include: {
            productVariant: {
              include: { product: true },
            },
          },
        },
      },
    });

    // Cashiers may reopen their own receipts only. 404 rather than 403, so the
    // endpoint does not confirm which sale ids exist.
    const isBackOffice = req.user?.role === 'ADMIN' || req.user?.role === 'MANAGER';
    if (!sale || (!isBackOffice && sale.userId !== req.user?.userId)) {
      res.status(404).json({ error: 'Sale receipt not found' });
      return;
    }

    res.json(sale);
  } catch (error: any) {
    handleError(res, error, 'Failed to fetch sale receipt');
  }
};
