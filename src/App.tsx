import { useRef, useState } from 'react'
import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Sales from './pages/Sales'
import Inventory from './pages/Inventory'
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'
import {
  LayoutDashboardIcon,
  ReceiptIcon,
  BoxesIcon,
  ChartIcon,
  SettingsIcon,
  PlusIcon,
  HomeIcon,
  MenuIcon,
  UserIcon,
  SearchIcon,
} from './components/icons'
import { RecordSaleSheet } from './components/RecordSaleSheet'
import { InsightsSheet } from './components/InsightsSheet'
import { BottomSheet, ToastStack, type ToastMessage } from './components/ui'
import { AppActionsContext } from './context/AppActions'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboardIcon, end: true },
  { to: '/sales', label: 'Sales', icon: ReceiptIcon, end: false },
  { to: '/inventory', label: 'Inventory', icon: BoxesIcon, end: false },
  { to: '/analytics', label: 'Analytics', icon: ChartIcon, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
]

const DOCK_ITEMS = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/sales', label: 'Orders', icon: ReceiptIcon, end: false },
  { to: '/inventory', label: 'Products', icon: BoxesIcon, end: false },
]

export default function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  )
}

function AppShell() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const nextToastId = useRef(1)
  const location = useLocation()
  const moreSectionActive = location.pathname.startsWith('/analytics') || location.pathname.startsWith('/settings')

  function showToast(text: string, tone: 'success' | 'error' = 'success') {
    const id = nextToastId.current++
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000)
  }

  return (
    <AppActionsContext.Provider value={{ openRecordSale: () => setSheetOpen(true), showToast }}>
      <div className="flex h-full min-h-screen w-full flex-col md:flex-row">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex md:w-60 md:shrink-0 md:flex-col md:border-r md:border-[var(--border)] md:bg-[var(--surface-1)]">
          <div className="px-5 py-6">
            <div className="text-lg font-semibold tracking-tight">Ledgr</div>
            <div className="text-xs text-[var(--text-muted)]">Sales &amp; Inventory</div>
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3">
            {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[var(--series-1)]/10 text-[var(--series-1)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--page-plane)]'
                  }`
                }
              >
                <Icon className="h-5 w-5 shrink-0" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="px-5 py-4 text-xs text-[var(--text-muted)]">
            Works fully offline. Data stays on this device.
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto pb-24 md:pb-0">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-8 md:py-8">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/sales" element={<Sales />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </main>

        {/* Floating action button — opens Record Sale from anywhere */}
        <button
          onClick={() => setSheetOpen(true)}
          aria-label="Quick record sale"
          className="fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--series-1)] text-white shadow-lg transition-transform active:scale-95 md:bottom-6 md:right-6"
        >
          <PlusIcon className="h-6 w-6" />
        </button>

        {/* Mobile bottom nav — Shopify-style: standalone search + avatar circles flanking a pill-shaped tab dock */}
        <nav className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 md:hidden">
          <button
            type="button"
            title="Search (coming soon)"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-muted)] shadow-lg"
          >
            <SearchIcon className="h-5 w-5" />
          </button>

          <div className="flex flex-1 items-center justify-around rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-1 py-1.5 shadow-lg">
            {DOCK_ITEMS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex min-w-0 flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-[10px] font-medium ${
                    isActive ? 'text-[var(--series-1)]' : 'text-[var(--text-muted)]'
                  }`
                }
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{label}</span>
              </NavLink>
            ))}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className={`flex min-w-0 flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-[10px] font-medium ${
                moreSectionActive ? 'text-[var(--series-1)]' : 'text-[var(--text-muted)]'
              }`}
            >
              <MenuIcon className="h-5 w-5 shrink-0" />
              <span className="truncate">Menu</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setInsightsOpen(true)}
            title="Ask about your sales"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--series-1)] shadow-lg"
          >
            <UserIcon className="h-5 w-5" />
          </button>
        </nav>

        <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)}>
          <div className="flex flex-col gap-1 pt-2">
            <h2 className="px-1 pb-2 text-sm font-semibold text-[var(--text-secondary)]">Menu</h2>
            <Link
              to="/analytics"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--page-plane)]"
            >
              <ChartIcon className="h-5 w-5" />
              Analytics
            </Link>
            <Link
              to="/settings"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--page-plane)]"
            >
              <SettingsIcon className="h-5 w-5" />
              Settings
            </Link>
          </div>
        </BottomSheet>

        <RecordSaleSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onSaved={(summary) => showToast(summary, 'success')}
          onError={(message) => showToast(message, 'error')}
        />
        <InsightsSheet open={insightsOpen} onClose={() => setInsightsOpen(false)} />
        <ToastStack toasts={toasts} />
      </div>
    </AppActionsContext.Provider>
  )
}
