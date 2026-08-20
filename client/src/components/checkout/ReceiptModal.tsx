import React from 'react';
import { Printer, CheckCircle2 } from 'lucide-react';
import type { Outlet, SaleReceipt } from '../../types/pos';

interface ReceiptModalProps {
  receipt: SaleReceipt | null;
  /** Terminal's outlet, used when the receipt itself carries no outlet (offline sales). */
  outlet?: Outlet;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ receipt, outlet, onClose }) => {
  if (!receipt) return null;

  const storeName = receipt.outlet?.name ?? outlet?.name ?? 'Sellkit POS Store';
  const storeAddress = receipt.outlet?.address ?? outlet?.address;
  const storePhone = receipt.outlet?.phone ?? outlet?.phone;

  const handlePrint = () => {
    window.print();
  };

  return (
    // `receipt-*` classes are print hooks: @media print in index.css unwraps this
    // modal chrome so a long receipt is not clipped by the scroll container or
    // by the backdrop-filter, which is a containing block for its descendants.
    <div className="receipt-overlay modal-overlay">
      <div className="receipt-panel panel w-full max-w-sm overflow-hidden flex flex-col max-h-[90vh]">
        {/* Top Notification */}
        <div className="no-print p-4 bg-success/10 border-b border-success/20 text-center flex flex-col items-center">
          <CheckCircle2 className="w-10 h-10 text-success mb-1 animate-bounce" />
          <h3 className="font-semibold text-base text-success tracking-tight">Payment Successful</h3>
          <span className="micro-label mt-0.5">Receipt <span className="num tracking-normal">#{receipt.receiptNumber}</span></span>
        </div>

        {/* 80mm Thermal Receipt Content — deliberately literal black on white,
            not themed: it is a preview of what the thermal printer emits. */}
        <div className="receipt-scroll flex-1 overflow-y-auto p-5 bg-white text-black font-mono text-xs select-text">
          <div id="printable-receipt" className="space-y-3">
            {/* Header */}
            <div className="text-center space-y-1">
              <h2 className="text-base font-black uppercase tracking-tight">{storeName}</h2>
              {storeAddress && <p className="text-[10px]">{storeAddress}</p>}
              {storePhone && <p className="text-[10px]">Tel: {storePhone}</p>}
              <div className="border-b border-dashed border-gray-400 my-2" />
            </div>

            {/* Meta */}
            <div className="text-[10px] space-y-0.5">
              <div className="flex justify-between">
                <span>Receipt #:</span>
                <span className="font-bold">{receipt.receiptNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Date:</span>
                <span>{new Date(receipt.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Cashier:</span>
                <span>{receipt.user?.name || 'Staff'}</span>
              </div>
              {receipt.customer && (
                <div className="flex justify-between">
                  <span>Customer:</span>
                  <span className="font-bold">{receipt.customer.name}</span>
                </div>
              )}
              {receipt.isOfflineSync && (
                <div className="text-amber-700 font-bold text-center mt-1">
                  *** OFFLINE SYNC TRANSACTION ***
                </div>
              )}
            </div>

            <div className="border-b border-dashed border-gray-400 my-2" />

            {/* Line Items */}
            <div className="space-y-1">
              <div className="flex justify-between font-bold text-[10px] uppercase">
                <span>Item</span>
                <span>Qty x Price</span>
                <span>Total</span>
              </div>

              {receipt.saleItems.map((item, idx) => (
                <div key={idx} className="flex justify-between text-[11px]">
                  <div className="flex flex-col max-w-[140px]">
                    <span className="font-bold truncate">
                      {item.productVariant?.product?.name || 'Item'}
                    </span>
                    <span className="text-[9px] text-gray-600">
                      {item.productVariant?.sku}
                    </span>
                  </div>
                  <span>
                    {item.quantity} x ${Number(item.unitPrice).toFixed(2)}
                  </span>
                  <span className="font-bold">${Number(item.totalPrice).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="border-b border-dashed border-gray-400 my-2" />

            {/* Totals */}
            <div className="space-y-1 text-right text-[11px]">
              <div className="flex justify-between">
                <span>Tax:</span>
                <span>${Number(receipt.tax || 0).toFixed(2)}</span>
              </div>
              {receipt.discount > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Discount:</span>
                  <span>-${Number(receipt.discount).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-black pt-1 border-t border-black">
                <span>TOTAL:</span>
                <span>${Number(receipt.totalAmount).toFixed(2)}</span>
              </div>
            </div>

            <div className="border-b border-dashed border-gray-400 my-2" />

            {/* Payment Splits */}
            <div className="text-[10px] space-y-0.5">
              <span className="font-bold uppercase">Payment Summary:</span>
              {receipt.paymentSplits.map((split, idx) => (
                <div key={idx} className="flex justify-between">
                  <span>{split.paymentMethod}:</span>
                  <span>${Number(split.amount).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="border-b border-dashed border-gray-400 my-2" />

            {/* Footer QR / Barcode Mockup */}
            <div className="text-center pt-2 space-y-1">
              <div className="font-mono text-[9px] tracking-widest bg-gray-100 py-1.5 border border-gray-300 rounded font-bold">
                ||| | |||| ||| |||| | ||| ||
              </div>
              <p className="text-[9px] font-bold">Thank you for shopping with us!</p>
              <p className="text-[8px] text-gray-500">Please retain receipt for returns</p>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="no-print p-4 border-t border-border bg-elevated flex items-center gap-3">
          <button
            onClick={onClose}
            className="btn-quiet flex-1 py-3 text-xs"
          >
            New Sale
          </button>
          <button
            onClick={handlePrint}
            className="btn-primary flex-1 py-3 text-xs"
          >
            <Printer className="w-4 h-4" />
            <span>Print Receipt</span>
          </button>
        </div>
      </div>
    </div>
  );
};
