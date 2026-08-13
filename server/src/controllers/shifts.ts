import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { AuthenticatedRequest } from '../middleware/auth';

// Open Shift Endpoint (/api/shifts/open)
export const openShift = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { tillId, openingFloat } = req.body;

    if (!userId || !tillId || openingFloat === undefined) {
      res.status(400).json({ error: 'User ID, Till ID, and Opening Float amount are required' });
      return;
    }

    // Check if there is already an active (unclosed) shift for this till or user
    const activeShift = await prisma.tillReconciliation.findFirst({
      where: {
        tillId,
        closedAt: null,
      },
    });

    if (activeShift) {
      res.status(400).json({
        error: 'An active open shift already exists for this till',
        activeShift,
      });
      return;
    }

    const shift = await prisma.tillReconciliation.create({
      data: {
        tillId,
        userId,
        openingFloat: Number(openingFloat),
        openedAt: new Date(),
      },
      include: {
        till: { include: { outlet: true } },
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    res.status(201).json(shift);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to open shift', details: error.message });
  }
};

// Close and Reconcile Shift Endpoint (/api/shifts/close)
export const closeShift = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { shiftId, actualCash, notes } = req.body;

    if (!shiftId || actualCash === undefined) {
      res.status(400).json({ error: 'Shift ID and actual cash amount are required' });
      return;
    }

    const shift = await prisma.tillReconciliation.findUnique({
      where: { id: shiftId },
    });

    if (!shift) {
      res.status(404).json({ error: 'Shift record not found' });
      return;
    }

    if (shift.closedAt) {
      res.status(400).json({ error: 'This shift has already been closed' });
      return;
    }

    // Calculate total cash payments for sales made on this till during this shift window
    const cashSales = await prisma.paymentSplit.aggregate({
      where: {
        paymentMethod: 'CASH',
        sale: {
          tillId: shift.tillId,
          createdAt: {
            gte: shift.openedAt,
          },
        },
      },
      _sum: {
        amount: true,
      },
    });

    const totalCashFromSales = Number(cashSales._sum.amount || 0);
    const expectedCash = Number(shift.openingFloat) + totalCashFromSales;
    const numericActualCash = Number(actualCash);
    const discrepancy = numericActualCash - expectedCash;

    const updatedShift = await prisma.tillReconciliation.update({
      where: { id: shiftId },
      data: {
        closedAt: new Date(),
        expectedCash,
        actualCash: numericActualCash,
        discrepancy,
        notes,
      },
      include: {
        till: { include: { outlet: true } },
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    res.json({
      message: 'Shift successfully closed and reconciled',
      summary: {
        openingFloat: shift.openingFloat,
        cashSalesTotal: totalCashFromSales,
        expectedCash,
        actualCash: numericActualCash,
        discrepancy,
      },
      shift: updatedShift,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to close shift', details: error.message });
  }
};

// Get current active shift status (/api/shifts/current)
export const getCurrentShift = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tillId = typeof req.query.tillId === 'string' ? req.query.tillId : undefined;

    const where: Prisma.TillReconciliationWhereInput = { closedAt: null };
    if (tillId) where.tillId = tillId;
    if (req.user?.userId) where.userId = req.user.userId;

    const activeShift = await prisma.tillReconciliation.findFirst({
      where,
      include: {
        till: { include: { outlet: true } },
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { openedAt: 'desc' },
    });

    if (!activeShift) {
      res.json({ active: false, shift: null });
      return;
    }

    // Calculate current live cash sales for shift
    const cashSales = await prisma.paymentSplit.aggregate({
      where: {
        paymentMethod: 'CASH',
        sale: {
          tillId: activeShift.tillId,
          createdAt: {
            gte: activeShift.openedAt,
          },
        },
      },
      _sum: {
        amount: true,
      },
    });

    const totalCashSales = Number(cashSales._sum.amount || 0);

    res.json({
      active: true,
      shift: activeShift,
      liveTotals: {
        openingFloat: activeShift.openingFloat,
        currentCashSales: totalCashSales,
        estimatedCurrentCash: Number(activeShift.openingFloat) + totalCashSales,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch active shift', details: error.message });
  }
};
