import type { CartItem } from '../types/pos';

export type DiscountMode = 'percent' | 'amount';

/** Order-level modifiers the cashier can attach before charging. */
export interface OrderModifiers {
  discountMode: DiscountMode;
  /** Raw input text, kept unparsed so a half-typed "1." doesn't jump to 1. */
  discountInput: string;
  note: string;
  couponCode: string;
}

export const emptyModifiers: OrderModifiers = {
  discountMode: 'percent',
  discountInput: '',
  note: '',
  couponCode: '',
};

export interface CartTotals {
  subtotal: number;
  tax: number;
  /** Absolute order-level discount, in currency. */
  orderDiscount: number;
  total: number;
}

/**
 * The single definition of what this cart costs.
 *
 * The panel shows it, the checkout modal charges it and the server re-derives it
 * as `subtotal + tax - discount` — so the order discount is taken off the taxed
 * total here too. Two copies of this arithmetic drifting apart is a payment that
 * fails split validation, or worse, a till that charges something other than what
 * the cashier read out.
 */
export function computeCartTotals(
  cart: CartItem[],
  taxRate: number,
  modifiers: OrderModifiers
): CartTotals {
  const subtotal = cart.reduce(
    (sum, item) => sum + item.unitPrice * (1 - (item.discount || 0) / 100) * item.quantity,
    0
  );
  const tax = subtotal * taxRate;

  const raw = parseFloat(modifiers.discountInput);
  const requested = isNaN(raw) || raw < 0 ? 0 : raw;
  const orderDiscount = Math.min(
    subtotal + tax,
    modifiers.discountMode === 'percent' ? subtotal * (Math.min(100, requested) / 100) : requested
  );

  return { subtotal, tax, orderDiscount, total: Math.max(0, subtotal + tax - orderDiscount) };
}
