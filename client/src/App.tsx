import { useState, useEffect, useCallback } from 'react';
import { UserCheck, Search, X, Loader2, UserX } from 'lucide-react';
import { Header } from './components/pos/Header';
import { ProductGrid } from './components/pos/ProductGrid';
import { CheckoutPanel } from './components/pos/CheckoutPanel';
import { CheckoutModal } from './components/checkout/CheckoutModal';
import { ReceiptModal } from './components/checkout/ReceiptModal';
import { PinModal } from './components/auth/PinModal';
import { SyncStatusToast } from './components/common/SyncStatusToast';
import { PwaUpdatePrompt } from './components/common/PwaUpdatePrompt';
import { apiFetch, getAuthToken, clearAuthToken } from './lib/api';
import { useOnlineStatus } from './lib/offline/sync';
import {
  saveCatalog,
  getCachedVariants,
  saveHeldCart,
  getHeldCarts,
  removeHeldCart,
  type HeldCart,
} from './lib/offline/db';
import { emptyModifiers, type OrderModifiers } from './lib/cartTotals';
import type {
  User,
  Category,
  Product,
  ProductVariant,
  CartItem,
  Customer,
  TillShift,
  SaleReceipt,
  BootstrapData,
} from './types/pos';

export function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentShift, setCurrentShift] = useState<TillShift | null>(null);
  const [session, setSession] = useState<BootstrapData | null>(null);
  const [isPinModalOpen, setIsPinModalOpen] = useState<boolean>(true);

  // Catalog Data
  const [categories, setCategories] = useState<Category[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);

  // Customers
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState<boolean>(false);

  // Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  // Order-level discount, coupon and note. Owned here so the checkout modal
  // charges exactly what the panel shows, and so a held cart can carry them.
  const [modifiers, setModifiers] = useState<OrderModifiers>(emptyModifiers);
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Modals
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState<boolean>(false);
  const [completedReceipt, setCompletedReceipt] = useState<SaleReceipt | null>(null);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState<boolean>(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState<string>('');

  // Dark Mode
  const [isDarkMode, setIsDarkMode] = useState<boolean>(
    () => localStorage.getItem('sellkit_theme') !== 'light'
  );

  // The theme class lives on <html>, not on a wrapper div: the CSS variables in
  // index.css are declared on :root/.dark, and body plus every modal (including
  // ones rendered through a portal, outside the React tree) has to inherit them.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDarkMode);
    root.style.colorScheme = isDarkMode ? 'dark' : 'light';
    localStorage.setItem('sellkit_theme', isDarkMode ? 'dark' : 'light');

    // Keep the installed PWA's title bar in step with the in-app theme.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', isDarkMode ? '#0f1524' : '#ffffff');
  }, [isDarkMode]);

  // Network Status
  const {
    isOnline,
    pendingSyncCount,
    blockedSyncCount,
    syncPhase,
    lastSyncError,
    lastSyncedCount,
    refreshQueue,
    retryFailedSync,
  } = useOnlineStatus();

  // Derive category pills from whatever variants we have, so they survive offline
  // reloads where only the cached variants (with a trimmed parent) are available.
  const deriveCategories = (list: ProductVariant[]): Category[] => {
    const map = new Map<string, Category>();
    for (const v of list) {
      const cat = v.product?.category;
      if (cat && !map.has(cat.id)) map.set(cat.id, cat);
    }
    return Array.from(map.values());
  };

  // Load Catalog Data (with IndexedDB fallback)
  const fetchCatalogData = useCallback(async () => {
    const loadFromCache = async () => {
      const cachedVariants = await getCachedVariants();
      setVariants(cachedVariants);
      setCategories(deriveCategories(cachedVariants));
    };

    if (!navigator.onLine) {
      await loadFromCache();
      return;
    }

    try {
      const productsData: Product[] = await apiFetch('/products');
      const allVariants: ProductVariant[] = [];
      const catsMap = new Map<string, Category>();

      for (const prod of productsData) {
        if (prod.category) catsMap.set(prod.category.id, prod.category);
        for (const v of prod.variants ?? []) {
          allVariants.push({ ...v, product: prod });
        }
      }

      setCategories(Array.from(catsMap.values()));
      setVariants(allVariants);

      // Cache catalog locally for offline use.
      await saveCatalog(productsData);
    } catch (err) {
      console.warn('Failed to fetch live products, loading from IndexedDB cache...', err);
      await loadFromCache();
    }
  }, []);

  // Load the terminal's outlet/till/shift. Every checkout depends on these ids.
  const fetchSession = useCallback(async (): Promise<BootstrapData | null> => {
    try {
      const data: BootstrapData = await apiFetch('/bootstrap');
      setSession(data);
      setCurrentShift(data.shift);
      return data;
    } catch (err) {
      console.error('Failed to bootstrap terminal:', err);
      return null;
    }
  }, []);

  const fetchCustomers = useCallback(async (search: string = '') => {
    if (!navigator.onLine) return;
    setIsLoadingCustomers(true);
    try {
      const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      setCustomers(await apiFetch(`/customers${query}`));
    } catch (err) {
      console.warn('Failed to fetch customers:', err);
    } finally {
      setIsLoadingCustomers(false);
    }
  }, []);

  // Initial Auth Check
  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setIsPinModalOpen(true);
      return;
    }

    apiFetch('/auth/me')
      .then(async (user: User) => {
        setCurrentUser(user);
        setIsPinModalOpen(false);
        await Promise.all([fetchSession(), fetchCatalogData(), fetchCustomers()]);
      })
      .catch(() => {
        clearAuthToken();
        setIsPinModalOpen(true);
      });
  }, [fetchSession, fetchCatalogData, fetchCustomers]);

  // Debounced customer search while the picker is open.
  useEffect(() => {
    if (!isCustomerModalOpen) return;
    const t = setTimeout(() => fetchCustomers(customerSearchQuery), 250);
    return () => clearTimeout(t);
  }, [customerSearchQuery, isCustomerModalOpen, fetchCustomers]);

  // Handle Cart Add
  const handleAddToCart = (variant: ProductVariant) => {
    setCart((prev) => {
      const existingIdx = prev.findIndex((i) => i.variant.id === variant.id);
      if (existingIdx >= 0) {
        return prev.map((item, idx) =>
          idx === existingIdx ? { ...item, quantity: item.quantity + 1 } : item
        );
      }

      return [
        ...prev,
        {
          variant,
          productName: variant.product?.name || 'Product',
          variantName: variant.name,
          quantity: 1,
          unitPrice: Number(variant.price),
          discount: 0,
        },
      ];
    });
  };

  // Handle Barcode Scanner Event. Returns whether the code matched a product,
  // so the grid can tell the cashier when a scan found nothing.
  const handleScanBarcode = async (scannedBarcode: string): Promise<boolean> => {
    const code = scannedBarcode.toLowerCase();
    const match = variants.find(
      (v) => v.barcode?.toLowerCase() === code || v.sku?.toLowerCase() === code
    );

    if (match) {
      handleAddToCart(match);
      return true;
    }

    // Not in the cached catalog — the server can still resolve it by barcode/SKU.
    if (!isOnline) return false;

    try {
      const results: ProductVariant[] = await apiFetch(
        `/products/search?barcode=${encodeURIComponent(scannedBarcode)}`
      );
      if (results.length > 0) {
        handleAddToCart(results[0]);
        return true;
      }
    } catch (err) {
      console.error('Barcode lookup failed:', err);
    }

    return false;
  };

  // Cart Handlers
  const handleUpdateQuantity = (variantId: string, delta: number) => {
    setCart((prev) =>
      prev.flatMap((item) => {
        if (item.variant.id !== variantId) return [item];
        const newQty = item.quantity + delta;
        return newQty > 0 ? [{ ...item, quantity: newQty }] : [];
      })
    );
  };

  const handleRemoveItem = (variantId: string) => {
    setCart((prev) => prev.filter((i) => i.variant.id !== variantId));
  };

  const handleApplyItemDiscount = (variantId: string, discountPercent: number) => {
    setCart((prev) =>
      prev.map((item) =>
        item.variant.id === variantId ? { ...item, discount: discountPercent } : item
      )
    );
  };

  // Hold / recall. Parked carts live in IndexedDB, not component state: a
  // reload or an accepted service-worker update must not lose a basket.
  const refreshHeldCarts = useCallback(async () => {
    try {
      setHeldCarts(await getHeldCarts());
    } catch (err) {
      console.error('Failed to read held carts:', err);
    }
  }, []);

  useEffect(() => {
    refreshHeldCarts();
  }, [refreshHeldCarts]);

  const handleHoldCart = async () => {
    if (cart.length === 0) return;
    const label = selectedCustomer?.name || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    try {
      // Only clear the till once the cart is durably on disk.
      await saveHeldCart(cart, selectedCustomer, modifiers, label);
      setCart([]);
      setSelectedCustomer(null);
      setModifiers(emptyModifiers);
      await refreshHeldCarts();
    } catch (err) {
      console.error('Failed to hold cart:', err);
    }
  };

  const handleRecallCart = async (id: string) => {
    const held = heldCarts.find((h) => h.id === id);
    if (!held) return;
    // Recalling onto a started cart would silently merge two customers' baskets.
    if (cart.length > 0) {
      await handleHoldCart();
    }
    setCart(held.cart);
    setSelectedCustomer(held.customer);
    setModifiers(held.modifiers ?? emptyModifiers);
    try {
      await removeHeldCart(id);
    } finally {
      await refreshHeldCarts();
    }
  };

  const handleDiscardHeldCart = async (id: string) => {
    try {
      await removeHeldCart(id);
    } finally {
      await refreshHeldCarts();
    }
  };

  const handleAuthSuccess = async (user: User, shift?: TillShift) => {
    setCurrentUser(user);
    if (shift) setCurrentShift(shift);
    setIsPinModalOpen(false);
    await Promise.all([fetchSession(), fetchCatalogData(), fetchCustomers()]);
  };

  const handleLogout = () => {
    clearAuthToken();
    setCurrentUser(null);
    setCurrentShift(null);
    setSession(null);
    setCart([]);
    setSelectedCustomer(null);
    setModifiers(emptyModifiers);
    setIsPinModalOpen(true);
  };

  const handleCheckoutSuccess = (receipt: SaleReceipt) => {
    setIsCheckoutModalOpen(false);
    setCart([]);
    setSelectedCustomer(null);
    setModifiers(emptyModifiers);
    setCompletedReceipt(receipt);
    fetchCatalogData(); // refresh stock numbers
    refreshQueue(); // an offline sale just joined the queue — show it immediately
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground">
      {/* Top Header */}
      <Header
        user={currentUser}
        shift={currentShift}
        outletName={session?.outlet.name}
        tillName={session?.till.name}
        isOnline={isOnline}
        pendingSyncCount={pendingSyncCount}
        blockedSyncCount={blockedSyncCount}
        syncPhase={syncPhase}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        onLogout={handleLogout}
      />

      {/* Main Terminal View */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Panel: Product Grid */}
        <ProductGrid
          categories={categories}
          variants={variants}
          onAddToCart={handleAddToCart}
          onScanBarcode={handleScanBarcode}
        />

        {/* Right Panel: Checkout Panel */}
        <CheckoutPanel
          cart={cart}
          customer={selectedCustomer}
          taxRate={session?.taxRate}
          onUpdateQty={handleUpdateQuantity}
          onRemove={handleRemoveItem}
          onDiscount={handleApplyItemDiscount}
          onClearCart={() => setCart([])}
          onOpenCustomer={() => setIsCustomerModalOpen(true)}
          onProceed={() => setIsCheckoutModalOpen(true)}
          modifiers={modifiers}
          onModifiersChange={setModifiers}
          heldCarts={heldCarts}
          onHoldCart={handleHoldCart}
          onRecallCart={handleRecallCart}
          onDiscardHeldCart={handleDiscardHeldCart}
        />
      </div>

      {/* Offline queue status */}
      <SyncStatusToast
        isOnline={isOnline}
        pendingSyncCount={pendingSyncCount}
        blockedSyncCount={blockedSyncCount}
        syncPhase={syncPhase}
        lastSyncError={lastSyncError}
        lastSyncedCount={lastSyncedCount}
        onRetry={retryFailedSync}
      />

      {/* New app version available — never applied without the cashier's say-so */}
      <PwaUpdatePrompt hasUnfinishedWork={cart.length > 0 || pendingSyncCount > 0} />

      {/* Cashier PIN / Shift Overlay */}
      <PinModal isOpen={isPinModalOpen} onSuccess={handleAuthSuccess} />

      {/* Checkout Payment Modal */}
      <CheckoutModal
        isOpen={isCheckoutModalOpen}
        cart={cart}
        customer={selectedCustomer}
        outletId={session?.outlet.id}
        tillId={session?.till.id}
        taxRate={session?.taxRate}
        modifiers={modifiers}
        isOnline={isOnline}
        onClose={() => setIsCheckoutModalOpen(false)}
        onSuccess={handleCheckoutSuccess}
      />

      {/* 80mm Thermal Receipt Modal */}
      <ReceiptModal
        receipt={completedReceipt}
        outlet={session?.outlet}
        onClose={() => setCompletedReceipt(null)}
      />

      {/* Customer Selection Modal */}
      {isCustomerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-card border border-border rounded-2xl p-5 shadow-2xl text-card-foreground space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base">Attach Customer</h3>
              <button
                onClick={() => setIsCustomerModalOpen(false)}
                className="text-muted hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input
                type="text"
                value={customerSearchQuery}
                onChange={(e) => setCustomerSearchQuery(e.target.value)}
                placeholder="Search by name, phone, or email..."
                className="w-full pl-9 pr-4 py-2 bg-surface border border-border rounded-xl text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
                autoFocus
              />
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {selectedCustomer && (
                <button
                  onClick={() => {
                    setSelectedCustomer(null);
                    setIsCustomerModalOpen(false);
                  }}
                  className="w-full p-3 bg-surface hover:bg-border/60 border border-border rounded-xl text-left flex items-center gap-3 transition"
                >
                  <div className="w-8 h-8 rounded-full bg-muted/20 text-muted flex items-center justify-center">
                    <UserX className="w-4 h-4" />
                  </div>
                  <h4 className="font-bold text-xs">Detach customer (walk-in sale)</h4>
                </button>
              )}

              {isLoadingCustomers && customers.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-muted text-xs">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading customers…
                </div>
              ) : customers.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted">
                  {customerSearchQuery.trim()
                    ? `No customers match "${customerSearchQuery.trim()}"`
                    : 'No customers on file yet'}
                </div>
              ) : (
                customers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedCustomer(c);
                      setIsCustomerModalOpen(false);
                    }}
                    className={`w-full p-3 bg-surface hover:bg-border/60 border rounded-xl text-left flex items-center justify-between transition ${
                      selectedCustomer?.id === c.id ? 'border-brand' : 'border-border'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand/20 text-brand flex items-center justify-center">
                        <UserCheck className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs">{c.name}</h4>
                        <span className="text-[10px] text-muted">
                          {c.phone || c.email || 'No contact details'}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-bold text-amber-400">
                      {c.loyaltyPoints} pts
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
