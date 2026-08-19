import { Wifi, WifiOff, RefreshCw, User, LogOut, Sun, Moon, Store, AlertTriangle, FileText, Calculator } from 'lucide-react';
import type { User as UserType, TillShift } from '../../types/pos';
import type { SyncPhase } from '../../lib/offline/sync';

interface Props {
  user: UserType | null;
  shift: TillShift | null;
  outletName?: string;
  tillName?: string;
  isOnline: boolean;
  pendingSyncCount: number;
  blockedSyncCount: number;
  syncPhase: SyncPhase;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onLogout: () => void;
  /** Mid-shift X-report: totals so far, drawer untouched. */
  onViewShiftReport: () => void;
  /** End-of-day drawer count and Z-report. */
  onCloseShift: () => void;
}

export function Header({ user, shift, outletName, tillName, isOnline, pendingSyncCount, blockedSyncCount, syncPhase, isDarkMode, onToggleDarkMode, onLogout, onViewShiftReport, onCloseShift }: Props) {
  return (
    <header className="h-14 bg-card border-b border-border px-4 flex items-center justify-between select-none shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center text-brand-foreground font-black text-sm shadow-md shadow-brand/30">S</div>
          <div className="leading-tight">
            <h1 className="font-extrabold text-sm tracking-tight">Sellkit POS</h1>
            <span className="text-[9px] uppercase font-bold tracking-widest text-muted">Enterprise</span>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold text-muted bg-surface px-2.5 py-1 rounded-lg border border-border">
          <Store className="w-3 h-3 text-brand" />
          <span>{outletName && tillName ? `${outletName} — ${tillName}` : 'Connecting terminal…'}</span>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${isOnline ? 'bg-success/10 text-success border-success/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-success animate-pulse' : 'bg-amber-400'}`} />
          {isOnline ? <><Wifi className="w-3 h-3" />ONLINE</> : <><WifiOff className="w-3 h-3" />OFFLINE</>}
        </div>
        {syncPhase === 'syncing' ? (
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand/10 text-brand border border-brand/30 text-[11px] font-bold" title="Uploading queued offline sales">
            <RefreshCw className="w-3 h-3 animate-spin" />Syncing…
          </div>
        ) : pendingSyncCount > 0 && (
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand/10 text-brand border border-brand/30 text-[11px] font-bold" title={`${pendingSyncCount} offline ${pendingSyncCount === 1 ? 'sale' : 'sales'} waiting to upload`}>
            <RefreshCw className="w-3 h-3" />{pendingSyncCount} pending
          </div>
        )}
        {blockedSyncCount > 0 && (
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-danger/10 text-danger border border-danger/30 text-[11px] font-bold" title="These sales were rejected by the server and need a manual retry">
            <AlertTriangle className="w-3 h-3" />{blockedSyncCount} sync error{blockedSyncCount === 1 ? '' : 's'}
          </div>
        )}
      </div>

      {/* User */}
      <div className="flex items-center gap-2">
        {shift && (
          <>
            <div className="hidden md:flex flex-col text-right text-[11px] leading-tight">
              <span className="text-muted">Float</span>
              <span className="font-mono font-bold">${Number(shift.openingFloat).toFixed(2)}</span>
            </div>
            <button onClick={onViewShiftReport} className="p-1.5 text-muted hover:text-brand bg-surface rounded-lg border border-border transition" title="X-report — shift totals so far">
              <FileText className="w-4 h-4" />
            </button>
            <button onClick={onCloseShift} className="flex items-center gap-1.5 px-2 py-1.5 text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg border border-amber-500/25 text-[11px] font-bold transition hover:bg-amber-500/20" title="Count the drawer and close this shift">
              <Calculator className="w-4 h-4" />
              <span className="hidden lg:inline">Close Shift</span>
            </button>
          </>
        )}
        <div className="flex items-center gap-1.5 bg-surface px-2 py-1 rounded-lg border border-border">
          <div className="w-6 h-6 rounded-full bg-brand/20 text-brand flex items-center justify-center"><User className="w-3.5 h-3.5" /></div>
          <div className="leading-tight text-left">
            <span className="text-[11px] font-bold block">{user?.name || 'Cashier'}</span>
            <span className="text-[9px] text-muted font-semibold uppercase">{user?.role || 'CASHIER'}</span>
          </div>
        </div>
        <button onClick={onToggleDarkMode} className="p-1.5 text-muted hover:text-foreground bg-surface rounded-lg border border-border transition" title="Theme">
          {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
        </button>
        <button onClick={onLogout} className="p-1.5 text-danger hover:text-danger/80 bg-danger/10 rounded-lg border border-danger/20 transition" title="Logout">
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
