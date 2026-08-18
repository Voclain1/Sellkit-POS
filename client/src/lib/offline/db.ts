import type { CartItem, Customer, Product, ProductVariant } from '../../types/pos';
import type { OrderModifiers } from '../cartTotals';

const DB_NAME = 'sellkit_pos_db';
const DB_VERSION = 2;

/**
 * `pending` — never tried, or only failed in a way worth retrying.
 * `failed`  — the server rejected it outright (4xx). Isolated from the sync loop
 *             so it cannot wedge the queue behind it; needs a manual retry.
 */
export type QueuedSaleStatus = 'pending' | 'failed';

export interface HeldCart {
  id: string;
  label: string;
  cart: CartItem[];
  customer: Customer | null;
  modifiers: OrderModifiers;
  heldAt: string;
}

export interface QueuedOfflineSale {
  id: string;
  payload: Record<string, unknown>;
  createdAt: string;
  status: QueuedSaleStatus;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('variants')) {
        const vs = db.createObjectStore('variants', { keyPath: 'id' });
        vs.createIndex('barcode', 'barcode', { unique: false });
        vs.createIndex('sku', 'sku', { unique: false });
      }
      if (!db.objectStoreNames.contains('offline_sales')) {
        db.createObjectStore('offline_sales', { keyPath: 'id' });
      }
      // v2: carts parked mid-sale. Kept on disk rather than in memory so a
      // reload, a crash or an accepted service-worker update cannot lose a
      // customer's basket while they fetch a forgotten item.
      if (!db.objectStoreNames.contains('held_carts')) {
        db.createObjectStore('held_carts', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Resolves when the transaction has actually committed.
 *
 * IndexedDB write requests fire their own onsuccess before the transaction
 * commits, so awaiting a request tells you nothing about durability. Every
 * writer below awaits this instead: a queued offline sale that is reported as
 * saved but lost on reload is a lost transaction at the till.
 */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Replace the cached catalog. Resolves once the write is committed. */
export async function saveCatalog(products: Product[]): Promise<void> {
  const db = await openDB();
  try {
    const tx = db.transaction(['products', 'variants'], 'readwrite');
    const ps = tx.objectStore('products');
    const vs = tx.objectStore('variants');
    ps.clear();
    vs.clear();

    for (const p of products) {
      ps.put(p);
      for (const v of p.variants ?? []) {
        // Store a trimmed parent on each variant so the grid can render offline
        // without a second lookup, minus the recursive variants array.
        vs.put({
          ...v,
          product: {
            id: p.id,
            categoryId: p.categoryId,
            name: p.name,
            category: p.category,
            variants: [],
          },
        });
      }
    }

    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function getCachedVariants(): Promise<ProductVariant[]> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction('variants', 'readonly');
    const variants = await requestDone(tx.objectStore('variants').getAll());
    await txDone(tx);
    return (variants ?? []) as ProductVariant[];
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/** Queue a sale made while offline. Resolves once the write is committed. */
export async function queueOfflineSale(
  payload: Record<string, unknown>
): Promise<QueuedOfflineSale> {
  const db = await openDB();
  try {
    const item: QueuedOfflineSale = {
      id: `OFF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      payload: { ...payload, isOfflineSync: true },
      createdAt: new Date().toISOString(),
      status: 'pending',
      attempts: 0,
    };

    const tx = db.transaction('offline_sales', 'readwrite');
    tx.objectStore('offline_sales').put(item);
    await txDone(tx);

    return item;
  } finally {
    db.close();
  }
}

/** Records written before the status/attempts fields existed still have to sync. */
function normalize(raw: QueuedOfflineSale): QueuedOfflineSale {
  return { ...raw, status: raw.status ?? 'pending', attempts: raw.attempts ?? 0 };
}

export async function getQueuedSales(): Promise<QueuedOfflineSale[]> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction('offline_sales', 'readonly');
    const sales = await requestDone(tx.objectStore('offline_sales').getAll());
    await txDone(tx);
    return ((sales ?? []) as QueuedOfflineSale[])
      .map(normalize)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/**
 * Stamp a failed sync attempt onto the queued sale so the reason survives a
 * reload and the cashier can see which sale is stuck and why.
 *
 * `permanent` flips it to `failed`, which takes it out of the auto-sync loop —
 * the record is never deleted, because it is a real sale that was taken.
 */
export async function recordSyncFailure(
  id: string,
  message: string,
  permanent: boolean
): Promise<void> {
  const db = await openDB();
  try {
    const tx = db.transaction('offline_sales', 'readwrite');
    const store = tx.objectStore('offline_sales');
    const existing = (await requestDone(store.get(id))) as QueuedOfflineSale | undefined;

    if (existing) {
      const current = normalize(existing);
      store.put({
        ...current,
        status: permanent ? 'failed' : 'pending',
        attempts: current.attempts + 1,
        lastError: message,
        lastAttemptAt: new Date().toISOString(),
      } satisfies QueuedOfflineSale);
    }

    await txDone(tx);
  } finally {
    db.close();
  }
}

/**
 * Move every isolated sale back into the sync loop, for the manual "Retry"
 * action after the cashier has fixed whatever the server objected to.
 * Returns how many were requeued.
 */
export async function requeueFailedSales(): Promise<number> {
  const db = await openDB();
  try {
    const tx = db.transaction('offline_sales', 'readwrite');
    const store = tx.objectStore('offline_sales');
    const all = ((await requestDone(store.getAll())) ?? []) as QueuedOfflineSale[];

    let requeued = 0;
    for (const raw of all) {
      const item = normalize(raw);
      if (item.status !== 'failed') continue;
      store.put({ ...item, status: 'pending' } satisfies QueuedOfflineSale);
      requeued += 1;
    }

    await txDone(tx);
    return requeued;
  } finally {
    db.close();
  }
}

/**
 * Drop a queued sale. Resolves once the delete is committed -- the sync loop
 * relies on this so a sale cannot be replayed after a successful POST.
 */
export async function removeQueuedSale(id: string): Promise<void> {
  const db = await openDB();
  try {
    const tx = db.transaction('offline_sales', 'readwrite');
    tx.objectStore('offline_sales').delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}

/** Park a cart. Resolves once the write is committed. */
export async function saveHeldCart(
  cart: CartItem[],
  customer: Customer | null,
  modifiers: OrderModifiers,
  label: string
): Promise<HeldCart> {
  const held: HeldCart = {
    id: `held-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    cart,
    customer,
    modifiers,
    heldAt: new Date().toISOString(),
  };

  const db = await openDB();
  try {
    const tx = db.transaction('held_carts', 'readwrite');
    tx.objectStore('held_carts').put(held);
    await txDone(tx);
    return held;
  } finally {
    db.close();
  }
}

/** Parked carts, oldest first. */
export async function getHeldCarts(): Promise<HeldCart[]> {
  const db = await openDB();
  try {
    const tx = db.transaction('held_carts', 'readonly');
    const carts = await requestDone(tx.objectStore('held_carts').getAll());
    await txDone(tx);
    return (carts as HeldCart[]).sort((a, b) => a.heldAt.localeCompare(b.heldAt));
  } finally {
    db.close();
  }
}

/** Drop a parked cart — on recall, or when the cashier discards it. */
export async function removeHeldCart(id: string): Promise<void> {
  const db = await openDB();
  try {
    const tx = db.transaction('held_carts', 'readwrite');
    tx.objectStore('held_carts').delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}
