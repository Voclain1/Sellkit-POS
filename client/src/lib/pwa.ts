import { registerSW } from 'virtual:pwa-register';

/**
 * Service worker registration for the POS shell.
 *
 * Deliberately manual rather than auto-injected: a till must never reload
 * itself mid-sale, so a waiting worker sits idle until `applyUpdate` is called
 * from the update prompt (see components/common/PwaUpdatePrompt.tsx).
 */

type Listener = () => void;

let needRefresh = false;
let offlineReady = false;
const listeners = new Set<Listener>();

const emit = () => listeners.forEach((fn) => fn());

/** Subscribe to registration state changes. Returns an unsubscribe function. */
export function subscribeToPwaState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const isUpdateReady = () => needRefresh;
export const isOfflineReady = () => offlineReady;

/** Dismiss the "cached and ready offline" confirmation. */
export function acknowledgeOfflineReady(): void {
  offlineReady = false;
  emit();
}

let updateServiceWorker: ((reload?: boolean) => Promise<void>) | undefined;

export function registerServiceWorker(): void {
  // No SW in dev (devOptions.enabled is false) and none without browser support.
  if (!('serviceWorker' in navigator)) return;

  updateServiceWorker = registerSW({
    onNeedRefresh() {
      needRefresh = true;
      emit();
    },
    onOfflineReady() {
      offlineReady = true;
      emit();
    },
    onRegisterError(err) {
      console.error('Service worker registration failed:', err);
    },
  });
}

/** Activate the waiting worker and reload. Called only on explicit user action. */
export async function applyUpdate(): Promise<void> {
  await updateServiceWorker?.(true);
}
