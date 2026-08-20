import { useState } from 'react';
import { Lock, ArrowRight, Store, LayoutDashboard } from 'lucide-react';
import { apiFetch, setAuthToken, clearAuthToken, ApiError } from '../../lib/api';
import { canAccessAdmin } from '../../lib/roles';
import { OpenShiftModal } from '../pos/OpenShiftModal';
import type { User, TillShift, BootstrapData } from '../../types/pos';

/** Which door the operator came in through. */
export type LoginMode = 'cashier' | 'admin';

/** Where App should land this session once the modal closes. */
export type LoginLanding = 'pos' | 'admin';

const MODES: {
  mode: LoginMode;
  label: string;
  icon: typeof Store;
  heading: string;
  blurb: string;
  demoPin: string;
}[] = [
  {
    mode: 'cashier',
    label: 'Cashier',
    icon: Store,
    heading: 'Cashier Quick-Login',
    blurb: 'Enter your 4-digit PIN to unlock',
    demoPin: '1234',
  },
  {
    mode: 'admin',
    label: 'Admin',
    icon: LayoutDashboard,
    heading: 'Back Office Login',
    blurb: 'Enter your 4-digit admin PIN',
    demoPin: '4321',
  },
];

/**
 * A dead API and a wrong PIN are different problems. Reporting both as
 * "Invalid PIN" sends the cashier hunting for a credential that was never wrong.
 */
function describeLoginError(e: unknown, afterAuth: boolean): string {
  if (e instanceof ApiError && e.status === 0) {
    return 'Cannot reach the server. Check that the API is running, then try again.';
  }
  if (!afterAuth && e instanceof ApiError && e.status === 401) {
    return 'Incorrect PIN. Try again.';
  }
  const detail = e instanceof Error ? e.message : 'Unknown error';
  return afterAuth ? `Signed in, but the terminal could not start: ${detail}` : detail;
}

interface Props {
  isOpen: boolean;
  onSuccess: (user: User, shift?: TillShift, landing?: LoginLanding) => void;
}

export function PinModal({ isOpen, onSuccess }: Props) {
  const [mode, setMode] = useState<LoginMode>('cashier');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [authedUser, setAuthedUser] = useState<User | null>(null);
  const [session, setSession] = useState<BootstrapData | null>(null);
  const [showFloat, setShowFloat] = useState(false);

  if (!isOpen) return null;

  const active = MODES.find((m) => m.mode === mode) ?? MODES[0];

  const press = (n: string) => { if (pin.length < 4) { setPin(p => p + n); setError(''); } };
  const back = () => { setPin(p => p.slice(0, -1)); setError(''); };
  const clear = () => { setPin(''); setError(''); };

  const switchMode = (next: LoginMode) => {
    if (next === mode || loading) return;
    // A PIN typed for the other door is never the right one here.
    setMode(next);
    setPin('');
    setError('');
  };

  const submitPin = async () => {
    if (pin.length !== 4) { setError('Enter 4-digit PIN'); return; }
    setLoading(true); setError('');

    // Whether the PIN itself was accepted. Anything that fails past that point
    // is a terminal problem, not a credential problem.
    let authed = false;

    try {
      const data = await apiFetch('/auth/pin-login', { method: 'POST', body: JSON.stringify({ pin }) });
      setAuthToken(data.token);
      const user: User = data.user;
      authed = true;

      // The keypad resolves a user from the PIN alone, so the mode buttons are a
      // statement of intent, not a filter. Enforce it here: an admin PIN may run
      // the till, but a cashier PIN must not open the back office.
      if (mode === 'admin' && !canAccessAdmin(user)) {
        clearAuthToken();
        setPin('');
        setError(`That PIN belongs to ${user.name} (${user.role}). Use an admin PIN, or sign in as Cashier.`);
        return;
      }

      setAuthedUser(user);

      // Straight to the back office: an admin reviewing stock has no drawer to
      // count, so the float prompt would only be in the way.
      if (mode === 'admin') { onSuccess(user, undefined, 'admin'); return; }

      // Resolve this terminal's outlet/till, and reuse the shift if one is already
      // open on the till (a hand-over mid-shift must not open a second one).
      const bootstrap: BootstrapData = await apiFetch('/bootstrap');
      setSession(bootstrap);

      if (bootstrap.shift) { onSuccess(user, bootstrap.shift, 'pos'); return; }
      setShowFloat(true);
    } catch (e: unknown) {
      const wrongPin = !authed && e instanceof ApiError && e.status === 401;
      setError(describeLoginError(e, authed));
      // Only wipe the keypad when the PIN was genuinely rejected -- clearing it
      // after a network blip just makes the cashier retype a correct PIN.
      if (wrongPin) setPin('');
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="panel w-full max-w-md p-6">
        {!showFloat ? (
          <>
            {/* Which door: the till, or the back office. */}
            <div className="flex bg-surface border border-border rounded-xl p-1 mb-5">
              {MODES.map((m) => {
                const Icon = m.icon;
                const isActive = mode === m.mode;
                return (
                  <button
                    key={m.mode}
                    type="button"
                    onClick={() => switchMode(m.mode)}
                    disabled={loading}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold
                      transition duration-150 active:scale-[0.98] disabled:opacity-50 ${
                      isActive
                        ? 'bg-brand text-brand-foreground shadow-[var(--shadow-press)]'
                        : 'text-muted hover:text-foreground'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    Login as {m.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col items-center mb-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-brand/10 text-brand ring-1 ring-inset ring-brand/25 flex items-center justify-center mb-3">
                <Lock className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">{active.heading}</h2>
              <p className="text-sm text-muted mt-1">{active.blurb}</p>
            </div>
            <div className="flex justify-center gap-4 mb-6">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`w-4 h-4 rounded-full transition-all duration-200 ${pin.length > i ? 'bg-brand scale-110 shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-brand)_20%,transparent)]' : 'bg-transparent ring-1 ring-border'}`} />
              ))}
            </div>
            {error && <div className="mb-4 text-center text-sm font-medium text-danger bg-danger/10 py-2 rounded-lg ring-1 ring-inset ring-danger/25">{error}</div>}
            <div className="grid grid-cols-3 gap-2.5 mb-4">
              {['1','2','3','4','5','6','7','8','9'].map(n => (
                <button key={n} type="button" onClick={() => press(n)} disabled={loading}
                  className="num py-4 text-2xl font-semibold bg-surface hover:brightness-125 active:scale-95 transition duration-150 rounded-xl text-foreground border border-border shadow-[var(--shadow-raised)]">{n}</button>
              ))}
              <button type="button" onClick={clear} disabled={loading}
                className="micro-label py-4 bg-surface/50 hover:text-foreground rounded-xl transition active:scale-95">Clear</button>
              <button type="button" onClick={() => press('0')} disabled={loading}
                className="num py-4 text-2xl font-semibold bg-surface hover:brightness-125 active:scale-95 transition duration-150 rounded-xl text-foreground border border-border shadow-[var(--shadow-raised)]">0</button>
              <button type="button" onClick={back} disabled={loading}
                className="py-4 text-sm font-semibold bg-surface/50 text-muted hover:text-foreground rounded-xl transition active:scale-95">⌫</button>
            </div>
            <button onClick={submitPin} disabled={loading || pin.length !== 4}
              className="btn-primary w-full py-3.5 text-sm">
              {loading ? 'Authenticating…' : 'Unlock Terminal'}<ArrowRight className="w-5 h-5" />
            </button>
            <p className="mt-3 text-center micro-label">Demo PIN <span className="num tracking-normal">{active.demoPin}</span></p>
          </>
        ) : (
          <OpenShiftModal
            isOpen
            embedded
            user={authedUser}
            tillId={session?.till.id}
            outletName={session?.outlet.name}
            tillName={session?.till.name}
            onOpened={(shift) => authedUser && onSuccess(authedUser, shift, 'pos')}
          />
        )}
      </div>
    </div>
  );
}
