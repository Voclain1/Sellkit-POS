import { Prisma } from '@prisma/client';

interface ShiftWindow {
  id: string;
  tillId: string;
  openedAt: Date;
  closedAt: Date | null;
}

/**
 * Which sales belong to a shift.
 *
 * Sales carry `shiftId` from the checkout that created them, so an offline sale
 * that syncs after the shift closed (or after the next one opened) still counts
 * towards the shift it was rung up in.
 *
 * Sales recorded before `shiftId` existed have it null; for those we fall back
 * to the old rule -- same till, inside the shift's time window.
 */
export function shiftSalesWhere(shift: ShiftWindow): Prisma.SaleWhereInput {
  return {
    OR: [
      { shiftId: shift.id },
      {
        shiftId: null,
        tillId: shift.tillId,
        createdAt: {
          gte: shift.openedAt,
          ...(shift.closedAt ? { lte: shift.closedAt } : {}),
        },
      },
    ],
  };
}
