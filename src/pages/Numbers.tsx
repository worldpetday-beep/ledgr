import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import {
  db,
  profitOf,
  EXCHANGE_RATE_KEY,
  DEFAULT_EXCHANGE_RATE,
  BRANCHES_KEY,
  DEFAULT_BRANCHES,
} from '../db'
import { money, dateKeyMonrovia, isLowStock, selectOnFocus, variantDisplayLabel } from '../lib/format'
import { withoutVoided } from '../lib/salesLedger'
import { fillCatalogPrices } from '../lib/catalogPriceFill'
import { FillMissingCostsView } from '../components/FillMissingCostsView'

const DAY_MS = 24 * 60 * 60 * 1000

function monroviaDayStart(ts: number): number {
  return new Date(`${dateKeyMonrovia(ts)}T00:00:00Z`).getTime()
}

function hasMissingCost(costUnknown: boolean, costPrice: number): boolean {
  return costUnknown || !costPrice
}

type Period = 'today' | 'week' | 'month'
const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
]

// Deliberately just five things: total revenue, profit, most sold (for
// whichever period is picked), low stock, and a one-tap way to fill in
// missing costs -- everything else that used to live here (the 14-day
// chart, the USD/LRD payment split, TBS/drawer KPIs) is still reachable
// from Book/Drawer, it just isn't cluttering the one screen meant to
// answer "how's the shop doing" at a glance. Every metric sits in its own
// rounded `.kpi`/`.card` container, not a wall of numbers.
export default function Numbers() {
  const [setupOpen, setSetupOpen] = useState(false)
  const [fillCostsOpen, setFillCostsOpen] = useState(false)
  const [period, setPeriod] = useState<Period>('today')
  const todayStart = monroviaDayStart(Date.now())
  const periodStart = period === 'today' ? todayStart : period === 'week' ? todayStart - 6 * DAY_MS : todayStart - 29 * DAY_MS

  const allSalesRaw = useLiveQuery(() => db.sales.toArray(), [])
  const allSales = useMemo(() => withoutVoided(allSalesRaw ?? []), [allSalesRaw])
  const periodSales = useMemo(() => allSales.filter((s) => s.timestamp >= periodStart), [allSales, periodStart])

  const products = useLiveQuery(() => db.products.toArray(), [])
  const variants = useLiveQuery(() => db.variants.toArray(), [])
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id!, p])), [products])

  const lowStockVariants = useMemo(
    () =>
      (variants ?? [])
        .filter((v) => isLowStock(v.stockMyShop, v.lowStockThreshold))
        .map((v) => ({ ...v, label: variantDisplayLabel(productById.get(v.productId)?.name ?? 'Unknown item', v.label) }))
        .sort((a, b) => a.stockMyShop - b.stockMyShop),
    [variants, productById],
  )
  const missingCostCount = useMemo(
    () => (variants ?? []).filter((v) => hasMissingCost(v.costUnknown, v.costPrice)).length,
    [variants],
  )

  const rev = periodSales.reduce((s, l) => s + l.soldFor + (l.secondaryAmount ?? 0), 0)
  const profit = periodSales.reduce((s, l) => s + profitOf(l), 0)

  const topItems = useMemo(() => {
    const m = new Map<string, { qty: number; rev: number }>()
    for (const s of periodSales) {
      const e = m.get(s.itemName) ?? { qty: 0, rev: 0 }
      e.qty += s.qty
      e.rev += s.soldFor + (s.secondaryAmount ?? 0)
      m.set(s.itemName, e)
    }
    return Array.from(m.entries()).sort((a, b) => b[1].rev - a[1].rev).slice(0, 5)
  }, [periodSales])

  return (
    <div className="cl flex min-h-[calc(100dvh-6rem)] flex-col md:min-h-[calc(100dvh-2rem)]">
      <div className="hd">
        <div>
          <h1>Numbers</h1>
          <div className="sub">How the shop's doing</div>
        </div>
        <button className="btn-s" onClick={() => setSetupOpen(true)}>⚙ Setup</button>
      </div>

      <div className="body">
        <div className="pad">
          <div className="chips" style={{ paddingTop: 0, marginBottom: 4 }}>
            {PERIOD_OPTIONS.map((opt) => (
              <button key={opt.value} className={period === opt.value ? 'on' : ''} onClick={() => setPeriod(opt.value)}>
                {opt.label}
              </button>
            ))}
          </div>

          <div className="g2" style={{ marginTop: 4 }}>
            <div className="kpi">
              <span className="k">Total revenue</span>
              <span className="v m">{money(rev, 'USD')}</span>
              <span className="s">{periodSales.length} sale{periodSales.length === 1 ? '' : 's'}</span>
            </div>
            <div className="kpi a">
              <span className="k">Profit</span>
              <span className="v m">{money(profit, 'USD')}</span>
              <span className="s">{rev ? Math.round((profit / rev) * 100) : 0}% margin</span>
            </div>
          </div>

          <p className="eb">Most sold<span className="n"> — {period === 'today' ? 'today' : period === 'week' ? 'this week' : 'this month'}</span></p>
          <div className="card">
            {topItems.length ? topItems.map(([name, v]) => (
              <div className="st" key={name}>
                <span className="k">{name} <span className="m" style={{ color: 'var(--cl-ink-3)' }}>{v.qty}</span></span>
                <span className="v m">{money(v.rev, 'USD')}</span>
              </div>
            )) : <p style={{ fontSize: 12.5, color: 'var(--cl-ink-3)', margin: 0 }}>No sales in this period yet.</p>}
          </div>

          <p className="eb">Low stock</p>
          <div className="card">
            {lowStockVariants.length ? lowStockVariants.slice(0, 6).map((v) => (
              <div className="st" key={v.id}>
                <span className="k">{v.label}</span>
                <span className="v m" style={{ color: 'var(--cl-alarm)' }}>{v.stockMyShop} left</span>
              </div>
            )) : <p style={{ fontSize: 12.5, color: 'var(--cl-ink-3)', margin: 0 }}>Nothing is low — everything is stocked.</p>}
          </div>
          <Link to="/inventory" className="m" style={{ display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 700, color: 'var(--cl-amber-2)' }}>
            View Stock →
          </Link>

          <p className="eb" style={{ marginTop: 14 }}>Costs to fill</p>
          <button
            className="card"
            style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, cursor: missingCostCount > 0 ? 'pointer' : 'default' }}
            onClick={() => missingCostCount > 0 && setFillCostsOpen(true)}
            disabled={missingCostCount === 0}
          >
            <span>
              <span className="v m" style={{ display: 'block', fontSize: 21, color: missingCostCount > 0 ? 'var(--cl-alarm)' : 'var(--cl-ink)' }}>
                {missingCostCount}
              </span>
              <span className="s" style={{ display: 'block' }}>{missingCostCount === 0 ? 'every item has a cost' : 'tap to fill them in, one at a time'}</span>
            </span>
            {missingCostCount > 0 && <span className="m" style={{ fontSize: 11, fontWeight: 700, color: 'var(--cl-amber-2)' }}>Fill now →</span>}
          </button>
        </div>
      </div>

      {setupOpen && <SetupSheet onClose={() => setSetupOpen(false)} />}
      {fillCostsOpen && <FillMissingCostsView onClose={() => setFillCostsOpen(false)} />}
    </div>
  )
}

// Everything the app already lets you configure, in one place: exchange
// rate, branches (editable/addable), categories, and backup/restore --
// folded in here since Numbers absorbed the old standalone Settings tab.
function SetupSheet({ onClose }: { onClose: () => void }) {
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), [])
  const [newCategory, setNewCategory] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const rateRow = useLiveQuery(() => db.settings.get(EXCHANGE_RATE_KEY), [])
  const [rateInput, setRateInput] = useState<string | null>(null)
  const rateValue = rateInput ?? rateRow?.value ?? String(DEFAULT_EXCHANGE_RATE)

  const branchesRow = useLiveQuery(() => db.settings.get(BRANCHES_KEY), [])
  const branches = useMemo<string[]>(() => {
    if (!branchesRow) return DEFAULT_BRANCHES
    try {
      const parsed = JSON.parse(branchesRow.value)
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_BRANCHES
    } catch {
      return DEFAULT_BRANCHES
    }
  }, [branchesRow])
  const [newBranch, setNewBranch] = useState('')

  async function saveRate(value: string) {
    setRateInput(value)
    const num = Number(value)
    if (num > 0) await db.settings.put({ key: EXCHANGE_RATE_KEY, value: String(num) })
  }
  async function saveBranches(next: string[]) {
    await db.settings.put({ key: BRANCHES_KEY, value: JSON.stringify(next) })
  }
  function addBranch() {
    const name = newBranch.trim()
    if (!name || branches.includes(name)) return
    saveBranches([...branches, name])
    setNewBranch('')
  }
  function removeBranch(name: string) {
    if (branches.length <= 1) return
    saveBranches(branches.filter((b) => b !== name))
  }
  async function addCategory() {
    const name = newCategory.trim()
    if (!name) return
    const exists = await db.categories.where('name').equalsIgnoreCase(name).first()
    if (!exists) await db.categories.add({ name })
    setNewCategory('')
  }
  async function removeCategory(id: number) {
    await db.categories.delete(id)
  }

  async function exportBackup() {
    const [products, variants, sales, cats, transfers, drawerCounts, warehouseLedger, abbreviations, customUnits] = await Promise.all([
      db.products.toArray(),
      db.variants.toArray(),
      db.sales.toArray(),
      db.categories.toArray(),
      db.stockTransfers.toArray(),
      db.drawerCounts.toArray(),
      db.warehouseLedger.toArray(),
      db.abbreviations.toArray(),
      db.customUnits.toArray(),
    ])
    const payload = {
      exportedAt: new Date().toISOString(),
      products, variants, sales, categories: cats, stockTransfers: transfers,
      drawerCounts, warehouseLedger, abbreviations, customUnits,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ledgr-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setStatus('Backup downloaded.')
  }

  async function importBackup(file: File) {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      await db.transaction('rw', db.products, db.variants, db.sales, db.categories, db.stockTransfers, async () => {
        const productIdMap = new Map<number, number>()
        if (Array.isArray(data.products)) {
          for (const product of data.products) {
            const { id, image, ...rest } = product
            const newId = (await db.products.add({ archived: false, description: '', images: [], options: [], ...rest })) as number
            if (id != null) productIdMap.set(id, newId)
          }
        }
        const variantIdMap = new Map<number, number>()
        if (Array.isArray(data.variants)) {
          for (const variant of data.variants) {
            const { id, productId, ...rest } = variant
            const newProductId = productIdMap.get(productId) ?? productId
            const newId = (await db.variants.add({ optionValues: [], ...rest, productId: newProductId })) as number
            if (id != null) variantIdMap.set(id, newId)
          }
        }
        if (Array.isArray(data.sales)) {
          for (const sale of data.sales) {
            const { id, productId, variantId, ...rest } = sale
            await db.sales.add({
              ...rest,
              productId: productId != null ? productIdMap.get(productId) ?? productId : undefined,
              variantId: variantId != null ? variantIdMap.get(variantId) ?? variantId : undefined,
            })
          }
        }
        if (Array.isArray(data.categories)) {
          for (const cat of data.categories) {
            const exists = await db.categories.where('name').equalsIgnoreCase(cat.name).first()
            if (!exists) await db.categories.add({ name: cat.name, allowedUnits: cat.allowedUnits })
          }
        }
        if (Array.isArray(data.stockTransfers)) {
          for (const transfer of data.stockTransfers) {
            const { id, productId, variantId, ...rest } = transfer
            await db.stockTransfers.add({
              ...rest,
              productId: productId != null ? productIdMap.get(productId) ?? productId : productId,
              variantId: variantId != null ? variantIdMap.get(variantId) ?? variantId : variantId,
            })
          }
        }
      })
      setStatus('Backup imported successfully.')
    } catch {
      setStatus('Could not read that file — make sure it is a Ledgr backup JSON.')
    }
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sbox" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="scroll" style={{ paddingBottom: 16 }}>
          <p className="eb">Setup</p>

          <div className="fld">
            <label className="lab">Liberian dollars per US$1</label>
            <input className="in m" inputMode="decimal" value={rateValue} onFocus={selectOnFocus} onChange={(e) => saveRate(e.target.value)} />
          </div>

          <div className="fld">
            <label className="lab">Branches</label>
            <div className="units" style={{ marginBottom: 8 }}>
              {branches.map((b) => (
                <span key={b} className="on" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--cl-ink)', background: 'var(--cl-ink)', color: 'var(--cl-bg)', borderRadius: 8, padding: '7px 11px', font: '700 12px Archivo' }}>
                  {b}
                  {branches.length > 1 && (
                    <button onClick={() => removeBranch(b)} aria-label="Remove branch" style={{ color: 'var(--cl-bg)', opacity: 0.7 }}>✕</button>
                  )}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="in" placeholder="New branch name" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addBranch()} />
              <button className="btn" style={{ width: 'auto', padding: '0 16px' }} onClick={addBranch}>Add</button>
            </div>
          </div>

          <div className="fld">
            <label className="lab">Categories</label>
            <div className="units" style={{ marginBottom: 8 }}>
              {(categories ?? []).map((c) => (
                <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--cl-line)', background: 'var(--cl-card)', color: 'var(--cl-ink-2)', borderRadius: 8, padding: '7px 11px', font: '700 12px Archivo' }}>
                  {c.name}
                  <button onClick={() => c.id && removeCategory(c.id)} aria-label="Remove category" style={{ color: 'var(--cl-ink-3)' }}>✕</button>
                </span>
              ))}
              {(categories ?? []).length === 0 && <p style={{ fontSize: 12.5, color: 'var(--cl-ink-3)', margin: 0 }}>No custom categories yet.</p>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="in" placeholder="New category name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCategory()} />
              <button className="btn" style={{ width: 'auto', padding: '0 16px' }} onClick={addCategory}>Add</button>
            </div>
          </div>

          <div className="fld">
            <label className="lab">Catalog price fill</label>
            <p style={{ fontSize: 11, color: 'var(--cl-ink-3)', margin: '0 0 8px', lineHeight: 1.5 }}>
              One-time fill for cost/selling prices on ~127 hardware-store items (matched by exact name; never
              overwrites a price you've already entered — mattresses are skipped, fill those by hand in Stock).
            </p>
            <button
              className="btn amber"
              onClick={async () => {
                const result = await fillCatalogPrices()
                setStatus(`Filled ${result.filled}, created ${result.created}, ${result.alreadyHadValues} already had prices.`)
              }}
            >
              Fill catalog prices
            </button>
          </div>

          <div className="fld">
            <label className="lab">Backup</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" style={{ width: 'auto', padding: '0 16px', height: 42 }} onClick={exportBackup}>Export backup</button>
              <button className="btn ghost" style={{ width: 'auto', padding: '0 16px', height: 42 }} onClick={() => fileInputRef.current?.click()}>Import backup</button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) importBackup(file)
                  e.target.value = ''
                }}
              />
            </div>
            {status && <p style={{ marginTop: 8, fontSize: 11, color: 'var(--cl-ink-3)' }}>{status}</p>}
          </div>
        </div>
        <div className="foot">
          <button className="btn ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
