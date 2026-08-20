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
        <div className="w-12 h-12 rounded-2xl bg-danger/10 text-danger ring-1 ring-inset ring-danger/25 flex items-center justify-center">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="font-semibold text-base tracking-tight">Back office is restricted</h2>
        <p className="text-xs text-muted max-w-sm">
          {user
            ? `${user.name} is signed in as ${user.role}. Inventory and analytics need an ADMIN or MANAGER account.`
            : 'Sign in with an ADMIN or MANAGER account to open the back office.'}
        </p>
        <button
          onClick={onExit}
          className="btn-quiet mt-1 px-3 py-2 text-xs"
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
            <span className="micro-label">Back Office</span>
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
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left whitespace-nowrap
                  transition duration-150 active:scale-[0.98] ${
                  isActive
                    ? 'bg-brand text-brand-foreground shadow-[var(--shadow-press),0_10px_24px_-12px_var(--color-brand)]'
                    : 'text-muted hover:text-foreground hover:bg-surface'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="leading-tight">
                  <span className="block text-xs font-semibold">{item.label}</span>
                  <span
                    className={`hidden md:block text-[10px] font-medium ${
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
            <div className="hidden md:flex items-start gap-1.5 px-2.5 py-1.5 rounded-xl bg-warning/10 text-warning ring-1 ring-inset ring-warning/25 text-[10px] font-medium leading-snug">
              <WifiOff className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>Offline — the back office is read/write against the server only.</span>
            </div>
          )}
          <button
            onClick={onExit}
            className="btn-quiet px-3 py-2 text-xs whitespace-nowrap"
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
