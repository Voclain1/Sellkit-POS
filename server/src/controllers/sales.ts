import { Response } from 'express';
import { Prisma, PaymentMethod } from '@prisma/client';
import { prisma } from '../prisma';
import { AuthenticatedRequest } from '../middleware/auth';

export interface CheckoutItemInput {
  productVariantId: string;
  quantity: number;
  unitPrice: number;
}

export interface PaymentSplitInput {
  paymentMethod: PaymentMethod;
  amount: number;
}

export interface CheckoutRequestInput {
  outletId: string;
  tillId: string;
  customerId?: string;
  items: CheckoutItemInput[];
  paymentSplits: PaymentSplitInput[];
  tax?: number;
  discount?: number;
  isOfflineSync?: boolean;
}

export const processCheckout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: User ID required for checkout' });
      return;
    }

    const {
      outletId,
      tillId,
      customerId,
      items,
      paymentSplits,
      tax = 0,
      discount = 0,
      isOfflineSync = false,
    }: CheckoutRequestInput = req.body;

    if (!outletId || !tillId || !items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Outlet ID, Till ID, and at least one item are required' });
      return;
    }

    if (!paymentSplits || !Array.isArray(paymentSplits) || paymentSplits.length === 0) {
      res.status(400).json({ error: 'At least one payment split is required' });
      return;
    }

    // Execute POS Checkout Engine inside a Prisma Interactive Transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Calculate total price and validate stock availability for each item
      let calculatedSubtotal = 0;
      const itemsToCreate = [];

      for (const item of items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.productVariantId },
          include: { product: true },
        });

        if (!variant) {
          throw new Error(`Product variant with ID ${item.productVariantId} not found`);
        }

        if (variant.stockQuantity < item.quantity) {
          throw new Error(
            `Insufficient stock for item "${variant.product.name} (${variant.name || 'Default'})". Available: ${variant.stockQuantity}, Requested: ${item.quantity}`
          );
        }

        const unitPrice = item.unitPrice !== undefined ? item.unitPrice : Number(variant.price);
        const itemTotalPrice = unitPrice * item.quantity;
        calculatedSubtotal += itemTotalPrice;

        itemsToCreate.push({
          productVariantId: variant.id,
          quantity: item.quantity,
          unitPrice,
          totalPrice: itemTotalPrice,
        });

        // Deduct stock quantity on ProductVariant
        await tx.productVariant.update({
          where: { id: variant.id },
          data: {
            stockQuantity: {
              decrement: item.quantity,
            },
          },
        });
      }

      const totalAmount = Math.max(0, calculatedSubtotal + Number(tax) - Number(discount));

      // Validate payment total matches sale total amount
      const totalPayments = paymentSplits.reduce((sum, p) => sum + Number(p.amount), 0);
      if (Math.abs(totalPayments - totalAmount) > 0.01) {
        throw new Error(
          `Payment breakdown sum ($${totalPayments.toFixed(2)}) does not match net total ($${totalAmount.toFixed(2)})`
        );
      }

      // Generate receipt number
      const timestampStr = Date.now().toString().slice(-6);
      const randomStr = Math.floor(1000 + Math.random() * 9000);
      const receiptNumber = `REC-${timestampStr}-${randomStr}`;

      // Create Sale record
      const sale = await tx.sale.create({
        data: {
          receiptNumber,
          totalAmount,
          tax,
          discount,
          isOfflineSync: Boolean(isOfflineSync),
          userId,
          outletId,
          tillId,
          customerId: customerId || null,
          saleItems: {
            create: itemsToCreate,
          },
          paymentSplits: {
            create: paymentSplits.map((p) => ({
              paymentMethod: p.paymentMethod,
              amount: p.amount,
            })),
          },
        },
        include: {
          saleItems: {
            include: {
              productVariant: {
                include: { product: true },
              },
            },
          },
          paymentSplits: true,
          customer: true,
          user: {
            select: { id: true, name: true, email: true },
          },
          outlet: true,
          till: true,
        },
      });

      // Assign loyalty points if customer exists (1 point per $10 spent)
      if (customerId) {
        const pointsEarned = Math.floor(totalAmount / 10);
        if (pointsEarned > 0) {
          await tx.customer.update({
            where: { id: customerId },
            data: {
              loyaltyPoints: {
                increment: pointsEarned,
              },
            },
          });
        }
      }

      return sale;
    });

    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ error: 'Checkout failed', message: error.message });
  }
};

// List Sales History
export const getSales = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const outletId = typeof req.query.outletId === 'string' ? req.query.outletId : undefined;
    const tillId = typeof req.query.tillId === 'string' ? req.query.tillId : undefined;
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined;
    const isOfflineSync = req.query.isOfflineSync !== undefined ? req.query.isOfflineSync === 'true' : undefined;

    const where: Prisma.SaleWhereInput = {};
    if (outletId) where.outletId = outletId;
    if (tillId) where.tillId = tillId;
    if (customerId) where.customerId = customerId;
    if (isOfflineSync !== undefined) where.isOfflineSync = isOfflineSync;

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
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json(sales);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch sales', details: error.message });
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

    if (!sale) {
      res.status(404).json({ error: 'Sale receipt not found' });
      return;
    }

    res.json(sale);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch sale receipt', details: error.message });
  }
};
