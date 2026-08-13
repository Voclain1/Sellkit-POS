export type Role = 'ADMIN' | 'MANAGER' | 'CASHIER';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  hasPinSet?: boolean;
}

export interface Outlet {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
}

export interface Till {
  id: string;
  name: string;
  outletId: string;
}

/** Payload of GET /api/bootstrap — where this terminal is and whether a shift is open. */
export interface BootstrapData {
  outlet: Outlet;
  till: Till;
  shift: TillShift | null;
  liveTotals: {
    openingFloat: number;
    currentCashSales: number;
    estimatedCurrentCash: number;
  } | null;
  taxRate: number;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  name?: string;
  sku: string;
  barcode?: string;
  price: number;
  cost: number;
  stockQuantity: number;
  product?: Product;
}

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  category?: Category;
  variants: ProductVariant[];
}

export interface CartItem {
  variant: ProductVariant;
  productName: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  loyaltyPoints: number;
}

export type PaymentMethod = 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'OTHER';

export interface PaymentSplitInput {
  paymentMethod: PaymentMethod;
  amount: number;
}

export interface SaleItem {
  id: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  productVariant: ProductVariant;
}

export interface PaymentSplit {
  id: string;
  paymentMethod: PaymentMethod;
  amount: number;
}

export interface SaleReceipt {
  id: string;
  receiptNumber: string;
  totalAmount: number;
  tax: number;
  discount: number;
  isOfflineSync: boolean;
  createdAt: string;
  user: { name: string; email: string };
  outlet?: { name: string; address?: string; phone?: string };
  till?: { name: string };
  customer?: Customer;
  saleItems: SaleItem[];
  paymentSplits: PaymentSplit[];
}

export interface TillShift {
  id: string;
  tillId: string;
  openingFloat: number;
  openedAt: string;
  closedAt?: string;
  expectedCash?: number;
  actualCash?: number;
  discrepancy?: number;
  user?: User;
}
