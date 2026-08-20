import { Wifi, WifiOff, RefreshCw, User, LogOut, Sun, Moon, Store, AlertTriangle, FileText, Calculator, LayoutDashboard, Monitor } from 'lucide-react';
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
  /**
   * Toggle the back office. Undefined for cashiers — the button is not rendered
   * at all rather than rendered disabled, so the till stays uncluttered.
   */
  onToggleAdmin?: () => void;
  /** True while the back office is on screen, so the button reads as a way back. */
  isAdminView?: boolean;
}

export function Header({ user, shift, outletName, tillName, isOnline, pendingSyncCount, blockedSyncCount, syncPhase, isDarkMode, onToggleDarkMode, onLogout, onViewShiftReport, onCloseShift, onToggleAdmin, isAdminView = false }: Props) {
  return (
    <header className="h-14 bg-card border-b border-border px-4 flex items-center justify-between select-none shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center text-brand-foreground font-bold text-sm ring-1 ring-inset ring-white/20 shadow-[0_6px_16px_-6px_var(--color-brand)]">S</div>
          <div className="leading-tight">
            <h1 className="font-semibold text-sm tracking-tight">Sellkit</h1>
            <span className="micro-label">Point of Sale</span>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-muted bg-surface px-2.5 py-1 rounded-lg border border-border">
          <Store className="w-3 h-3 text-brand" />
          <span>{outletName && tillName ? `${outletName} — ${tillName}` : 'Connecting terminal…'}</span>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        <div className={isOnline ? 'pill-success' : 'pill-warning'}>
          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-success animate-pulse' : 'bg-warning'}`} />
          {isOnline ? <><Wifi className="w-3 h-3" />Online</> : <><WifiOff className="w-3 h-3" />Offline</>}
        </div>
        {syncPhase === 'syncing' ? (
          <div className="pill-brand" title="Uploading queued offline sales">
            <RefreshCw className="w-3 h-3 animate-spin" />Syncing
          </div>
        ) : pendingSyncCount > 0 && (
          <div className="pill-brand" title={`${pendingSyncCount} offline ${pendingSyncCount === 1 ? 'sale' : 'sales'} waiting to upload`}>
            <RefreshCw className="w-3 h-3" /><span className="num">{pendingSyncCount}</span> pending
          </div>
        )}
        {blockedSyncCount > 0 && (
          <div className="pill-danger" title="These sales were rejected by the server and need a manual retry">
            <AlertTriangle className="w-3 h-3" /><span className="num">{blockedSyncCount}</span> sync error{blockedSyncCount === 1 ? '' : 's'}
          </div>
        )}
      </div>

      {/* User */}
      <div className="flex items-center gap-2">
        {onToggleAdmin && (
          <button
            onClick={onToggleAdmin}
            className={`${isAdminView ? 'btn-primary' : 'btn-quiet'} px-2.5 py-1.5 text-[11px]`}
            title={isAdminView ? 'Return to the till' : 'Inventory and analytics'}
          >
            {isAdminView ? <Monitor className="w-4 h-4" /> : <LayoutDashboard className="w-4 h-4" />}
            <span className="hidden lg:inline">{isAdminView ? 'Till' : 'Back Office'}</span>
          </button>
        )}
        {shift && !isAdminView && (
          <>
            <div className="hidden md:flex flex-col text-right leading-tight">
              <span className="micro-label">Float</span>
              <span className="num text-[11px] font-semibold">${Number(shift.openingFloat).toFixed(2)}</span>
            </div>
            <button onClick={onViewShiftReport} className="btn-quiet p-1.5 hover:text-brand" title="X-report — shift totals so far">
              <FileText className="w-4 h-4" />
            </button>
            <button onClick={onCloseShift} className="btn-warning px-2.5 py-1.5 text-[11px]" title="Count the drawer and close this shift">
              <Calculator className="w-4 h-4" />
              <span className="hidden lg:inline">Close Shift</span>
            </button>
          </>
        )}
        <div className="flex items-center gap-2 bg-surface px-2 py-1 rounded-lg border border-border">
          <div className="w-6 h-6 rounded-full bg-brand/12 text-brand ring-1 ring-inset ring-brand/25 flex items-center justify-center"><User className="w-3.5 h-3.5" /></div>
          <div className="leading-tight text-left">
            <span className="text-[11px] font-semibold block">{user?.name || 'Cashier'}</span>
            <span className="micro-label">{user?.role || 'CASHIER'}</span>
          </div>
        </div>
        <button onClick={onToggleDarkMode} className="btn-quiet p-1.5" title="Theme">
          {isDarkMode ? <Sun className="w-4 h-4 text-warning" /> : <Moon className="w-4 h-4" />}
        </button>
        <button onClick={onLogout} className="btn-danger p-1.5" title="Logout">
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
