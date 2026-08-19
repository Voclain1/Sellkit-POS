import { useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';
import { apiFetch, setAuthToken, ApiError } from '../../lib/api';
import { OpenShiftModal } from '../pos/OpenShiftModal';
import type { User, TillShift, BootstrapData } from '../../types/pos';

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
  onSuccess: (user: User, shift?: TillShift) => void;
}

export function PinModal({ isOpen, onSuccess }: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [authedUser, setAuthedUser] = useState<User | null>(null);
  const [session, setSession] = useState<BootstrapData | null>(null);
  const [showFloat, setShowFloat] = useState(false);

  if (!isOpen) return null;

  const press = (n: string) => { if (pin.length < 4) { setPin(p => p + n); setError(''); } };
  const back = () => { setPin(p => p.slice(0, -1)); setError(''); };
  const clear = () => { setPin(''); setError(''); };

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
      setAuthedUser(user);
      authed = true;

      // Resolve this terminal's outlet/till, and reuse the shift if one is already
      // open on the till (a hand-over mid-shift must not open a second one).
      const bootstrap: BootstrapData = await apiFetch('/bootstrap');
      setSession(bootstrap);

      if (bootstrap.shift) { onSuccess(user, bootstrap.shift); return; }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 text-card-foreground">
        {!showFloat ? (
          <>
            <div className="flex flex-col items-center mb-6 text-center">
              <div className="w-14 h-14 rounded-full bg-brand/10 text-brand flex items-center justify-center mb-3">
                <Lock className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Cashier Quick-Login</h2>
              <p className="text-sm text-muted mt-1">Enter your 4-digit PIN to unlock</p>
            </div>
            <div className="flex justify-center gap-4 mb-6">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`w-5 h-5 rounded-full border-2 transition-all duration-200 ${pin.length > i ? 'bg-brand border-brand scale-110 shadow-lg shadow-brand/40' : 'border-muted/40'}`} />
              ))}
            </div>
            {error && <div className="mb-4 text-center text-sm font-medium text-danger bg-danger/10 py-2 rounded-lg border border-danger/20">{error}</div>}
            <div className="grid grid-cols-3 gap-2.5 mb-4">
              {['1','2','3','4','5','6','7','8','9'].map(n => (
                <button key={n} type="button" onClick={() => press(n)} disabled={loading}
                  className="py-4 text-2xl font-bold bg-surface hover:brightness-110 active:scale-95 transition rounded-xl text-foreground border border-border">{n}</button>
              ))}
              <button type="button" onClick={clear} disabled={loading}
                className="py-4 text-xs font-bold bg-surface/50 text-muted rounded-xl">CLR</button>
              <button type="button" onClick={() => press('0')} disabled={loading}
                className="py-4 text-2xl font-bold bg-surface hover:brightness-110 active:scale-95 transition rounded-xl text-foreground border border-border">0</button>
              <button type="button" onClick={back} disabled={loading}
                className="py-4 text-sm font-bold bg-surface/50 text-muted rounded-xl">⌫</button>
            </div>
            <button onClick={submitPin} disabled={loading || pin.length !== 4}
              className="w-full py-3.5 bg-brand hover:brightness-110 disabled:opacity-40 text-brand-foreground font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2">
              {loading ? 'Authenticating…' : 'Unlock Terminal'}<ArrowRight className="w-5 h-5" />
            </button>
            <p className="mt-3 text-center text-xs text-muted">Demo PIN: 1234</p>
          </>
        ) : (
          <OpenShiftModal
            isOpen
            embedded
            user={authedUser}
            tillId={session?.till.id}
            outletName={session?.outlet.name}
            tillName={session?.till.name}
            onOpened={(shift) => authedUser && onSuccess(authedUser, shift)}
          />
        )}
      </div>
    </div>
  );
}
