import { HashRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
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
} from './components/icons'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboardIcon, end: true },
  { to: '/sales', label: 'Sales', icon: ReceiptIcon, end: false },
  { to: '/inventory', label: 'Inventory', icon: BoxesIcon, end: false },
  { to: '/analytics', label: 'Analytics', icon: ChartIcon, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
]

export default function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  )
}

function AppShell() {
  const navigate = useNavigate()

  function openRecordSale() {
    navigate('/sales', { state: { record: Date.now() } })
  }

  return (
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
      <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
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
        onClick={openRecordSale}
        aria-label="Quick record sale"
        className="fixed bottom-20 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--series-1)] text-white shadow-lg transition-transform active:scale-95 md:bottom-6 md:right-6"
      >
        <PlusIcon className="h-6 w-6" />
      </button>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-[var(--border)] bg-[var(--surface-1)] md:hidden">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium ${
                isActive ? 'text-[var(--series-1)]' : 'text-[var(--text-muted)]'
              }`
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
