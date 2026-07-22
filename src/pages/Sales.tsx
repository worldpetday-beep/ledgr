import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, profitOf, type Currency, type Item } from '../db'
import { Card, Button, Field, inputClass } from '../components/ui'
import { PlusIcon, SearchIcon, TrashIcon } from '../components/icons'
import { money, startOfDay, endOfDay } from '../lib/format'
import { format } from 'date-fns'

export default function Sales() {
  const [dateStr, setDateStr] = useState(() => format(Date.now(), 'yyyy-MM-dd'))
  const [formOpen, setFormOpen] = useState(true)

  const dayStart = startOfDay(new Date(dateStr).getTime())
  const dayEnd = endOfDay(new Date(dateStr).getTime())

  const sales = useLiveQuery(
    () => db.sales.where('timestamp').between(dayStart, dayEnd, true, true).reverse().sortBy('timestamp'),
    [dayStart, dayEnd],
  )

  const totals = useMemo(() => {
    const t: Record<Currency, { sales: number; profit: number }> = {
      USD: { sales: 0, profit: 0 },
      LRD: { sales: 0, profit: 0 },
    }
    for (const s of sales ?? []) {
      t[s.currency].sales += s.soldFor
      t[s.currency].profit += profitOf(s)
    }
    return t
  }, [sales])

  async function deleteSale(id: number, itemId: number | undefined, qty: number) {
    await db.transaction('rw', db.sales, db.items, async () => {
      await db.sales.delete(id)
      if (itemId) {
        const item = await db.items.get(itemId)
        if (item) await db.items.update(itemId, { stock: item.stock + qty, updatedAt: Date.now() })
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Sales Ledger</h1>
          <p className="text-sm text-[var(--text-secondary)]">Record and review daily sales</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className={inputClass + ' w-auto'}
          />
          <Button onClick={() => setFormOpen((v) => !v)}>
            <PlusIcon className="h-4 w-4" />
            Record sale
          </Button>
        </div>
      </div>

      {formOpen && <SaleForm onDone={() => {}} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <div className="text-xs font-medium text-[var(--text-muted)]">Total sales (USD)</div>
          <div className="tabular text-lg font-semibold">{money(totals.USD.sales, 'USD')}</div>
        </Card>
        <Card>
          <div className="text-xs font-medium text-[var(--text-muted)]">Total profit (USD)</div>
          <div className="tabular text-lg font-semibold text-[var(--status-good)]">{money(totals.USD.profit, 'USD')}</div>
        </Card>
        <Card>
          <div className="text-xs font-medium text-[var(--text-muted)]">Total sales (LRD)</div>
          <div className="tabular text-lg font-semibold">{money(totals.LRD.sales, 'LRD')}</div>
        </Card>
        <Card>
          <div className="text-xs font-medium text-[var(--text-muted)]">Total profit (LRD)</div>
          <div className="tabular text-lg font-semibold text-[var(--status-good)]">{money(totals.LRD.profit, 'LRD')}</div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">
          {sales?.length ?? 0} sale{sales?.length === 1 ? '' : 's'} on {format(new Date(dateStr), 'MMM d, yyyy')}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-[var(--text-muted)]">
                <th className="pb-2 font-medium">Item</th>
                <th className="pb-2 font-medium">Qty</th>
                <th className="pb-2 font-medium">Sold for</th>
                <th className="pb-2 font-medium">Cost</th>
                <th className="pb-2 font-medium">Profit</th>
                <th className="pb-2 font-medium">Time</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(sales ?? []).map((s) => (
                <tr key={s.id} className="border-t border-[var(--gridline)]">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{s.itemName}</div>
                    {s.variant && <div className="text-xs text-[var(--text-muted)]">{s.variant}</div>}
                  </td>
                  <td className="tabular py-2 pr-2">{s.qty}</td>
                  <td className="tabular py-2 pr-2">{money(s.soldFor, s.currency)}</td>
                  <td className="tabular py-2 pr-2 text-[var(--text-muted)]">{money(s.costAtSale, s.currency)}</td>
                  <td className="tabular py-2 pr-2 text-[var(--status-good)]">{money(profitOf(s), s.currency)}</td>
                  <td className="py-2 pr-2 text-[var(--text-muted)]">{format(s.timestamp, 'h:mm a')}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => s.id && deleteSale(s.id, s.itemId, s.qty)}
                      className="text-[var(--text-muted)] hover:text-[var(--status-critical)]"
                      aria-label="Delete sale"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {sales?.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-[var(--text-muted)]">
                    No sales recorded for this day yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function SaleForm({ onDone }: { onDone: () => void }) {
  const items = useLiveQuery(() => db.items.orderBy('name').toArray(), [])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Item | null>(null)
  const [qty, setQty] = useState(1)
  const [soldFor, setSoldFor] = useState<number>(0)
  const [currency, setCurrency] = useState<Currency>('USD')
  const [manualName, setManualName] = useState('')
  const [manualCost, setManualCost] = useState<number>(0)

  const filtered = useMemo(() => {
    if (!query.trim()) return (items ?? []).slice(0, 8)
    const q = query.toLowerCase()
    return (items ?? []).filter((it) => it.name.toLowerCase().includes(q)).slice(0, 8)
  }, [items, query])

  function pick(item: Item) {
    setSelected(item)
    setQuery(item.name)
    setCurrency(item.currency)
    setSoldFor(item.sellPrice * qty)
  }

  function changeQty(next: number) {
    setQty(next)
    if (selected) setSoldFor(selected.sellPrice * next)
  }

  const costTotal = selected ? selected.costPrice * qty : manualCost
  const profitPreview = soldFor - costTotal

  async function submit() {
    const name = selected ? selected.name : manualName.trim()
    if (!name || qty <= 0 || soldFor < 0) return

    await db.transaction('rw', db.sales, db.items, async () => {
      await db.sales.add({
        itemId: selected?.id,
        itemName: name,
        category: selected?.category,
        variant: selected?.variant,
        qty,
        soldFor,
        costAtSale: costTotal,
        currency,
        timestamp: Date.now(),
      })
      if (selected?.id) {
        const fresh = await db.items.get(selected.id)
        if (fresh) {
          await db.items.update(selected.id, {
            stock: Math.max(0, fresh.stock - qty),
            updatedAt: Date.now(),
          })
        }
      }
    })

    setSelected(null)
    setQuery('')
    setQty(1)
    setSoldFor(0)
    setManualName('')
    setManualCost(0)
    onDone()
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">Record a sale</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Item">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              className={inputClass + ' pl-9'}
              placeholder="Search inventory or type a new item name"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelected(null)
                setManualName(e.target.value)
              }}
            />
            {query && !selected && filtered.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-lg">
                {filtered.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => pick(it)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--page-plane)]"
                  >
                    <span>{it.name}</span>
                    <span className="tabular text-xs text-[var(--text-muted)]">{it.stock} in stock</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {!selected && query && (
            <span className="text-xs text-[var(--text-muted)]">Not in inventory — will be logged as a quick sale (stock won't be tracked).</span>
          )}
        </Field>

        <Field label="Quantity">
          <input
            type="number"
            min={1}
            className={inputClass}
            value={qty}
            onChange={(e) => changeQty(Number(e.target.value) || 1)}
          />
        </Field>

        <Field label="Sold for (total)">
          <input
            type="number"
            min={0}
            step="0.01"
            className={inputClass}
            value={soldFor}
            onChange={(e) => setSoldFor(Number(e.target.value) || 0)}
          />
        </Field>

        <Field label="Currency">
          <select
            className={inputClass}
            value={currency}
            disabled={!!selected}
            onChange={(e) => setCurrency(e.target.value as Currency)}
          >
            <option value="USD">USD</option>
            <option value="LRD">LRD</option>
          </select>
        </Field>

        {!selected && (
          <Field label="Cost (total, optional)">
            <input
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              value={manualCost}
              onChange={(e) => setManualCost(Number(e.target.value) || 0)}
            />
          </Field>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-[var(--gridline)] pt-3">
        <div className="text-sm text-[var(--text-secondary)]">
          Profit preview: <span className="tabular font-semibold text-[var(--status-good)]">{money(profitPreview, currency)}</span>
        </div>
        <Button onClick={submit}>Record sale</Button>
      </div>
    </Card>
  )
}
