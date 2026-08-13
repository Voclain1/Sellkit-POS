import { useState } from 'react';
import { Lock, ArrowRight, DollarSign } from 'lucide-react';
import { apiFetch, setAuthToken } from '../../lib/api';
import type { User, TillShift, BootstrapData } from '../../types/pos';

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
  const [openingFloat, setOpeningFloat] = useState('100.00');

  if (!isOpen) return null;

  const press = (n: string) => { if (pin.length < 4) { setPin(p => p + n); setError(''); } };
  const back = () => { setPin(p => p.slice(0, -1)); setError(''); };
  const clear = () => { setPin(''); setError(''); };

  const submitPin = async () => {
    if (pin.length !== 4) { setError('Enter 4-digit PIN'); return; }
    setLoading(true); setError('');
    try {
      const data = await apiFetch('/auth/pin-login', { method: 'POST', body: JSON.stringify({ pin }) });
      setAuthToken(data.token);
      const user: User = data.user;
      setAuthedUser(user);

      // Resolve this terminal's outlet/till, and reuse the shift if one is already
      // open on the till (a hand-over mid-shift must not open a second one).
      const bootstrap: BootstrapData = await apiFetch('/bootstrap');
      setSession(bootstrap);

      if (bootstrap.shift) { onSuccess(user, bootstrap.shift); return; }
      setShowFloat(true);
    } catch (e: any) {
      setError(e.message || 'Invalid PIN'); setPin('');
    } finally { setLoading(false); }
  };

  const submitFloat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authedUser) return;
    const val = parseFloat(openingFloat);
    if (isNaN(val) || val < 0) { setError('Enter valid float amount'); return; }
    if (!session?.till.id) { setError('Terminal is not bound to a till yet. Reconnect and try again.'); return; }
    setLoading(true);
    try {
      const shift: TillShift = await apiFetch('/shifts/open', {
        method: 'POST',
        body: JSON.stringify({ tillId: session.till.id, openingFloat: val }),
      });
      onSuccess(authedUser, shift);
    } catch (e: any) { setError(e.message || 'Failed to open shift'); }
    finally { setLoading(false); }
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
          <form onSubmit={submitFloat}>
            <div className="flex flex-col items-center mb-6 text-center">
              <div className="w-14 h-14 rounded-full bg-success/10 text-success flex items-center justify-center mb-3">
                <DollarSign className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold">Open Till Shift</h2>
              <p className="text-sm text-muted mt-1">Welcome, <span className="font-semibold text-foreground">{authedUser?.name}</span></p>
              {session && (
                <p className="text-xs text-muted mt-0.5">{session.outlet.name} — {session.till.name}</p>
              )}
            </div>
            {error && <div className="mb-4 text-center text-sm text-danger bg-danger/10 py-2 rounded-lg border border-danger/20">{error}</div>}
            <label className="block text-xs font-bold text-muted uppercase tracking-wider mb-2">Opening Float ($)</label>
            <div className="relative mb-6">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-muted font-mono">$</span>
              <input type="number" step="0.01" min="0" value={openingFloat} onChange={e => setOpeningFloat(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-surface border border-border rounded-xl text-3xl font-bold font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-brand" autoFocus />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-3.5 bg-success hover:brightness-110 text-success-foreground font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2">
              {loading ? 'Opening…' : 'Start Shift'}<ArrowRight className="w-5 h-5" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
