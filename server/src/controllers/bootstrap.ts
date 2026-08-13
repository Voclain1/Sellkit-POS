import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { DEFAULT_IDS } from '../lib/defaults';

/**
 * GET /api/bootstrap
 *
 * One call that tells a freshly authenticated terminal where it is: which outlet
 * and till to post sales against, and whether a shift is already open. Without
 * this the client has no source for those UUIDs and every checkout fails its
 * foreign-key checks.
 *
 * Optional query params:
 *   outletId - pin the terminal to a specific outlet
 *   tillId   - pin the terminal to a specific till
 */
export const getBootstrap = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const requestedOutletId =
      typeof req.query.outletId === 'string' ? req.query.outletId : undefined;
    const requestedTillId = typeof req.query.tillId === 'string' ? req.query.tillId : undefined;

    // Outlet: explicit request, else the deterministic seeded outlet, else the oldest.
    const outlet =
      (requestedOutletId
        ? await prisma.outlet.findUnique({ where: { id: requestedOutletId } })
        : null) ??
      (await prisma.outlet.findUnique({ where: { id: DEFAULT_IDS.outlet } })) ??
      (await prisma.outlet.findFirst({ orderBy: { createdAt: 'asc' } }));

    if (!outlet) {
      res.status(503).json({
        error: 'No outlet configured',
        message: 'The database has no Outlet records. Run `npm run seed` in server/ first.',
      });
      return;
    }

    // Till must belong to the resolved outlet, so a stale client-side tillId cannot
    // pair a till with the wrong outlet.
    const till =
      (requestedTillId
        ? await prisma.till.findFirst({ where: { id: requestedTillId, outletId: outlet.id } })
        : null) ??
      (await prisma.till.findFirst({ where: { id: DEFAULT_IDS.till, outletId: outlet.id } })) ??
      (await prisma.till.findFirst({
        where: { outletId: outlet.id },
        orderBy: { createdAt: 'asc' },
      }));

    if (!till) {
      res.status(503).json({
        error: 'No till configured',
        message: `Outlet "${outlet.name}" has no Till records. Run \`npm run seed\` in server/ first.`,
      });
      return;
    }

    // Any shift still open on this till, whoever opened it -- a cashier taking over
    // a till mid-shift needs to see it rather than open a second one.
    const shift = await prisma.tillReconciliation.findFirst({
      where: { tillId: till.id, closedAt: null },
      include: {
        till: { include: { outlet: true } },
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { openedAt: 'desc' },
    });

    let liveTotals: {
      openingFloat: number;
      currentCashSales: number;
      estimatedCurrentCash: number;
    } | null = null;

    if (shift) {
      const cashSales = await prisma.paymentSplit.aggregate({
        where: {
          paymentMethod: 'CASH',
          sale: { tillId: till.id, createdAt: { gte: shift.openedAt } },
        },
        _sum: { amount: true },
      });

      const currentCashSales = Number(cashSales._sum.amount || 0);
      liveTotals = {
        openingFloat: Number(shift.openingFloat),
        currentCashSales,
        estimatedCurrentCash: Number(shift.openingFloat) + currentCashSales,
      };
    }

    res.json({
      outlet,
      till,
      shift,
      liveTotals,
      user: req.user ?? null,
      taxRate: 0.08,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to bootstrap terminal', details: error.message });
  }
};
