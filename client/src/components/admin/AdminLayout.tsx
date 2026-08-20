import { useState } from 'react';
import { BarChart3, Boxes, ArrowLeft, ShieldAlert, WifiOff } from 'lucide-react';
import { AnalyticsDashboard } from './AnalyticsDashboard';
import { InventoryManager } from './InventoryManager';
import { canAccessAdmin } from '../../lib/roles';
import type { User } from '../../types/pos';

type AdminTab = 'analytics' | 'inventory';

const NAV: { tab: AdminTab; label: string; icon: typeof BarChart3; blurb: string }[] = [
  { tab: 'analytics', label: 'Analytics', icon: BarChart3, blurb: 'Revenue & top sellers' },
  { tab: 'inventory', label: 'Inventory', icon: Boxes, blurb: 'Stock & product catalog' },
];

interface Props {
  user: User | null;
  isOnline: boolean;
  /** Back to the till. */
  onExit: () => void;
  /** Re-pull the POS catalog after a price or stock edit. */
  onCatalogChanged?: () => void;
}

export function AdminLayout({ user, isOnline, onExit, onCatalogChanged }: Props) {
  const [tab, setTab] = useState<AdminTab>('analytics');
  // Set when the operator clicks the low-stock card, so Inventory opens filtered.
  const [lowStockOnly, setLowStockOnly] = useState<boolean>(false);

  // Belt and braces: App only renders this for admins, but a role change mid-session
  // must not leave trading figures on screen.
  if (!canAccessAdmin(user)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center bg-background text-foreground">
        <div className="w-12 h-12 rounded-2xl bg-danger/10 text-danger border border-danger/25 flex items-center justify-center">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="font-extrabold text-base">Back office is restricted</h2>
        <p className="text-xs text-muted max-w-sm">
          {user
            ? `${user.name} is signed in as ${user.role}. Inventory and analytics need an ADMIN or MANAGER account.`
            : 'Sign in with an ADMIN or MANAGER account to open the back office.'}
        </p>
        <button
          onClick={onExit}
          className="mt-1 flex items-center gap-1.5 px-3 py-2 bg-surface border border-border rounded-xl text-xs font-bold text-muted hover:text-foreground transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to the till
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-background text-foreground">
      {/* Sidebar — a horizontal strip on narrow screens */}
      <nav className="md:w-56 shrink-0 bg-card border-b md:border-b-0 md:border-r border-border flex md:flex-col md:justify-between overflow-x-auto md:overflow-visible">
        <div className="flex md:flex-col gap-1 p-2 md:p-3 md:w-full">
          <div className="hidden md:block px-2 pb-2">
            <span className="text-[10px] uppercase font-bold tracking-widest text-muted">
              Back Office
            </span>
          </div>

          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.tab;
            return (
              <button
                key={item.tab}
                onClick={() => {
                  setTab(item.tab);
                  if (item.tab !== 'inventory') setLowStockOnly(false);
                }}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition whitespace-nowrap ${
                  isActive
                    ? 'bg-brand text-brand-foreground shadow-sm shadow-brand/25'
                    : 'text-muted hover:text-foreground hover:bg-surface'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="leading-tight">
                  <span className="block text-xs font-extrabold">{item.label}</span>
                  <span
                    className={`hidden md:block text-[10px] font-semibold ${
                      isActive ? 'text-brand-foreground/70' : 'text-muted'
                    }`}
                  >
                    {item.blurb}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-2 md:p-3 flex md:flex-col items-center md:items-stretch gap-2 shrink-0">
          {!isOnline && (
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 text-[10px] font-bold">
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              <span>Offline — the back office is read/write against the server only.</span>
            </div>
          )}
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-border rounded-xl text-xs font-bold text-muted hover:text-foreground transition whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Till
          </button>
        </div>
      </nav>

      {/* Active view */}
      <main className="flex-1 overflow-y-auto">
        {tab === 'analytics' ? (
          <AnalyticsDashboard
            onReviewLowStock={() => {
              setLowStockOnly(true);
              setTab('inventory');
            }}
          />
        ) : (
          <InventoryManager
            initialLowStockOnly={lowStockOnly}
            onCatalogChanged={onCatalogChanged}
          />
        )}
      </main>
    </div>
  );
}
