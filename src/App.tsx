import { useRef, useState } from 'react'
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import Sell from './pages/Sell'
import Book from './pages/Book'
import Drawer from './pages/Drawer'
import Inventory from './pages/Inventory'
import Numbers from './pages/Numbers'
import { ReceiptIcon, BoxesIcon, ChartIcon, UserIcon } from './components/icons'
import { InsightsSheet } from './components/InsightsSheet'
import { ToastStack, type ToastMessage } from './components/ui'
import { AppActionsContext } from './context/AppActions'

// Five tabs, matching the counter-ledger reference exactly: Sell (fast
// entry, the app's home screen) · Book (what did we sell) · Drawer
// (what's physically in the till) · Stock (the catalog) · Numbers
// (KPIs + Setup gear, which absorbed the old standalone Settings tab).
const NAV_ITEMS = [
  { to: '/', label: 'Sell', icon: ReceiptIcon, end: true },
  { to: '/book', label: 'Book', icon: BoxesIcon, end: false },
  { to: '/drawer', label: 'Drawer', icon: ReceiptIcon, end: false },
  { to: '/inventory', label: 'Stock', icon: BoxesIcon, end: false },
  { to: '/numbers', label: 'Numbers', icon: ChartIcon, end: false },
]

export default function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  )
}

function AppShell() {
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const nextToastId = useRef(1)

  function showToast(text: string, tone: 'success' | 'error' = 'success') {
    const id = nextToastId.current++
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000)
  }

  return (
    <AppActionsContext.Provider value={{ showToast }}>
      <div className="cl flex h-full min-h-screen w-full flex-col md:flex-row">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex md:w-56 md:shrink-0 md:flex-col border-r" style={{ borderColor: 'var(--cl-line)', background: 'var(--cl-card)' }}>
          <div className="px-5 py-6">
            <div className="text-lg font-bold tracking-tight">Ledgr</div>
            <div className="text-xs [color:var(--cl-ink-3)]">Counter Ledger</div>
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3">
            {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                    isActive ? '' : 'hover:[background:var(--cl-line-2)]'
                  }`
                }
                style={({ isActive }) => (isActive ? { background: 'var(--cl-ink)', color: 'var(--cl-bg)' } : { color: 'var(--cl-ink-2)' })}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="px-5 py-4 text-xs [color:var(--cl-ink-3)]">Works fully offline. Data stays on this device.</div>
        </aside>

        {/* Every tab now owns its own full-bleed shell (ShopifyShell) */}
        <main className="flex-1 overflow-y-auto pb-24 md:pb-0">
          <Routes>
            <Route path="/" element={<Sell />} />
            <Route path="/book" element={<Book />} />
            <Route path="/drawer" element={<Drawer />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/numbers" element={<Numbers />} />
          </Routes>
        </main>

        {/* Mobile bottom nav */}
        <nav
          className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:hidden"
          style={{ background: 'var(--cl-card)', borderTop: '1px solid var(--cl-line)' }}
        >
          <div className="flex flex-1 items-center justify-around">
            {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className="flex min-w-0 flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-bold"
              >
                {({ isActive }) => (
                  <>
                    <span style={{ color: isActive ? 'var(--cl-amber-2)' : 'var(--cl-ink-3)' }}>
                      <Icon className="h-5 w-5 shrink-0" />
                    </span>
                    <span className="truncate" style={{ color: isActive ? 'var(--cl-ink)' : 'var(--cl-ink-3)' }}>{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setInsightsOpen(true)}
            title="Ask about your sales"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border"
            style={{ borderColor: 'var(--cl-line)', color: 'var(--cl-amber-2)' }}
          >
            <UserIcon className="h-5 w-5" />
          </button>
        </nav>

        <InsightsSheet open={insightsOpen} onClose={() => setInsightsOpen(false)} />
        <ToastStack toasts={toasts} />
      </div>
    </AppActionsContext.Provider>
  )
}
