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
import { format, subDays } from 'date-fns'

const DAY_MS = 24 * 60 * 60 * 1000

function monroviaDayStart(ts: number): number {
  return new Date(`${dateKeyMonrovia(ts)}T00:00:00Z`).getTime()
}

// KPIs, a 14-day bar chart, best sellers and running-low, matching the
// reference Numbers screen's layout/classes exactly. The Setup gear
// absorbed the old standalone Settings tab (exchange rate, categories,
// backup) plus the new editable/addable Branches list.
export default function Numbers() {
  const [setupOpen, setSetupOpen] = useState(false)
  const todayStart = monroviaDayStart(Date.now())
  const weekStart = todayStart - 6 * DAY_MS

  const allSalesRaw = useLiveQuery(() => db.sales.toArray(), [])
  const allSales = useMemo(() => withoutVoided(allSalesRaw ?? []), [allSalesRaw])
  const wk = useMemo(() => allSales.filter((s) => s.timestamp >= weekStart), [allSales, weekStart])

  const rateRow = useLiveQuery(() => db.settings.get(EXCHANGE_RATE_KEY), [])
  const rate = rateRow ? Number(rateRow.value) : DEFAULT_EXCHANGE_RATE

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

  const rev = wk.reduce((s, l) => s + l.soldFor + (l.secondaryAmount ?? 0), 0)
  const profit = wk.reduce((s, l) => s + profitOf(l), 0)
  const wU = wk.filter((s) => s.currency === 'USD').reduce((s, l) => s + l.soldFor, 0) + wk.reduce((s, l) => s + (l.secondaryCurrency === 'USD' ? l.secondaryAmount ?? 0 : 0), 0)
  const wL = wk.filter((s) => s.currency === 'LRD').reduce((s, l) => s + l.soldFor, 0) + wk.reduce((s, l) => s + (l.secondaryCurrency === 'LRD' ? l.secondaryAmount ?? 0 : 0), 0)
  const owedTbs = allSales.filter((s) => s.tbs && !s.pickedUp).length

  const cashOutWk = useLiveQuery(async () => {
    const rows = await db.drawerCounts.where('timestamp').aboveOrEqual(weekStart).toArray()
    return rows.reduce((sum, r) => sum + (r.outs ?? []).reduce((s, o) => s + o.amt / (o.cur === 'LRD' ? rate : 1), 0), 0)
  }, [weekStart, rate]) ?? 0

  const days = useMemo(() => {
    const out: { key: string; label: string; rev: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const ts = Date.now() - i * DAY_MS
      const key = dateKeyMonrovia(ts)
      const dayRev = allSales.filter((s) => dateKeyMonrovia(s.timestamp) === key).reduce((s, l) => s + l.soldFor + (l.secondaryAmount ?? 0), 0)
      out.push({ key, label: format(subDays(Date.now(), i), 'd'), rev: dayRev })
    }
    return out
  }, [allSales])
  const maxDay = Math.max(...days.map((d) => d.rev), 1)
  const todayKey = dateKeyMonrovia(Date.now())

  const topItems = useMemo(() => {
    const m = new Map<string, { qty: number; rev: number }>()
    for (const s of wk) {
      const e = m.get(s.itemName) ?? { qty: 0, rev: 0 }
      e.qty += s.qty
      e.rev += s.soldFor + (s.secondaryAmount ?? 0)
      m.set(s.itemName, e)
    }
    return Array.from(m.entries()).sort((a, b) => b[1].rev - a[1].rev).slice(0, 5)
  }, [wk])

  return (
    <div className="cl flex min-h-[calc(100dvh-6rem)] flex-col md:min-h-[calc(100dvh-2rem)]">
      <div className="hd">
        <div>
          <h1>Numbers</h1>
          <div className="sub">Last 7 days</div>
        </div>
        <button className="btn-s" onClick={() => setSetupOpen(true)}>⚙ Setup</button>
      </div>

      <div className="body">
        <div className="pad">
          <div className="g2" style={{ marginTop: 4 }}>
            <div className="kpi">
              <span className="k">Sold</span>
              <span className="v m">{money(rev, 'USD')}</span>
              <span className="s">{wk.length} sales</span>
            </div>
            <div className="kpi a">
              <span className="k">Gross profit</span>
              <span className="v m">{money(profit, 'USD')}</span>
              <span className="s">{rev ? Math.round((profit / rev) * 100) : 0}% margin</span>
            </div>
          </div>
          <div className="g2">
            <div className={`kpi${owedTbs > 0 ? ' r' : ''}`}>
              <span className="k">Owed to you</span>
              <span className="v m">{owedTbs}</span>
              <span className="s">item{owedTbs === 1 ? '' : 's'} to supply</span>
            </div>
            <div className="kpi">
              <span className="k">Given out / taken</span>
              <span className="v m">{money(cashOutWk, 'USD')}</span>
              <span className="s">from the drawer</span>
            </div>
          </div>

          <p className="eb">Last 14 days</p>
          <div className="chart">
            {days.map((dd) => (
              <div key={dd.key} className={`b${dd.key === todayKey ? ' on' : ''}`} style={{ height: `${Math.max(3, (dd.rev / maxDay) * 100)}%` }} title={`${dd.key} ${money(dd.rev, 'USD')}`} />
            ))}
          </div>
          <div className="xax">
            {days.map((dd, i) => <span key={dd.key}>{i % 2 === 0 ? dd.label : ''}</span>)}
          </div>
          <p style={{ fontSize: 11, color: 'var(--cl-ink-3)', marginTop: 7 }}>Best day {money(maxDay, 'USD')}</p>

          <p className="eb">How they paid</p>
          <div className="card">
            <div style={{ height: 12, display: 'flex', borderRadius: 99, overflow: 'hidden', background: 'var(--cl-line)', marginBottom: 10 }}>
              <div style={{ width: `${(wU / ((wU + wL) || 1)) * 100}%`, background: 'var(--cl-usd)' }} />
              <div style={{ width: `${(wL / ((wU + wL) || 1)) * 100}%`, background: 'var(--cl-lrd)' }} />
            </div>
            <div className="st"><span className="k">US dollars</span><span className="v m" style={{ color: 'var(--cl-usd)' }}>{money(wU, 'USD')}</span></div>
            <div className="st"><span className="k">Liberian dollars</span><span className="v m" style={{ color: 'var(--cl-lrd)' }}>{money(wL, 'LRD')}</span></div>
          </div>

          <p className="eb">Best sellers</p>
          <div className="card">
            {topItems.length ? topItems.map(([name, v]) => (
              <div className="st" key={name}>
                <span className="k">{name} <span className="m" style={{ color: 'var(--cl-ink-3)' }}>{v.qty}</span></span>
                <span className="v m">{money(v.rev, 'USD')}</span>
              </div>
            )) : <p style={{ fontSize: 12.5, color: 'var(--cl-ink-3)', margin: 0 }}>No sales this week yet.</p>}
          </div>

          <p className="eb">Running low<span className="n"> — buy more of these</span></p>
          <div className="card">
            {lowStockVariants.length ? lowStockVariants.slice(0, 12).map((v) => (
              <div className="st" key={v.id}>
                <span className="k">{v.label}</span>
                <span className="v m" style={{ color: 'var(--cl-alarm)' }}>{v.stockMyShop} left</span>
              </div>
            )) : <p style={{ fontSize: 12.5, color: 'var(--cl-ink-3)', margin: 0 }}>Nothing is low — everything is stocked.</p>}
          </div>
          <Link to="/inventory" className="m" style={{ display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 700, color: 'var(--cl-amber-2)' }}>
            View Stock →
          </Link>
        </div>
      </div>

      {setupOpen && <SetupSheet onClose={() => setSetupOpen(false)} />}
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
