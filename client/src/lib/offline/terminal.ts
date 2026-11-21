import type { BootstrapData, User } from '../../types/pos';

/**
 * The terminal's last known context: who is signed in, which outlet and till
 * it posts against, the tax rate and the open shift.
 *
 * All of it normally comes from the server (/auth/me and /api/bootstrap). Kept
 * only in memory, a reload with the network down lost it, and the till could not
 * ring up a single sale until the connection came back -- the one situation an
 * offline-first till exists for. It is saved here on every change and restored
 * when the server cannot be reached.
 *
 * localStorage rather than IndexedDB: it is tiny, and reading it synchronously
 * on boot avoids a flash of the sign-in screen before the restore lands.
 */
const KEY = 'sellkit_terminal_context';
const VERSION = 1;

export interface TerminalContext {
  user: User;
  session: BootstrapData;
  savedAt: string;
}

interface Stored extends TerminalContext {
  v: number;
}

export function saveTerminalContext(user: User, session: BootstrapData): void {
  const stored: Stored = { v: VERSION, user, session, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch (err) {
    // Storage full or blocked: the till still works online, it just cannot
    // restore itself after an offline reload.
    console.warn('Could not save terminal context for offline use:', err);
  }
}

export function loadTerminalContext(): TerminalContext | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (
      parsed.v !== VERSION ||
      !parsed.user?.id ||
      !parsed.session?.outlet?.id ||
      !parsed.session?.till?.id ||
      typeof parsed.session.taxRate !== 'number'
    ) {
      return null;
    }
    return { user: parsed.user, session: parsed.session, savedAt: parsed.savedAt ?? '' };
  } catch {
    return null;
  }
}

export function clearTerminalContext(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
