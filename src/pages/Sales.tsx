import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useLocation } from 'react-router-dom'
import { db, profitOf, reserveNextCustomerNumber, peekNextCustomerNumber, NEXT_CUSTOMER_NUMBER_KEY, type Currency, type Item, type Sale } from '../db'
import { Card, Button, Field, inputClass, Badge, Pill, Switch } from '../components/ui'
import { ItemThumb } from '../components/ItemThumb'
import { PlusIcon, SearchIcon, TrashIcon, EditIcon } from '../components/icons'
import { money, startOfDay, endOfDay, selectOnFocus, formatTimeMonrovia } from '../lib/format'
import { format } from 'date-fns'

const UNIT_TYPES = ['Piece', 'Carton', 'Sheet', 'Bundle', 'Yard', 'Gallon', 'Bucket', 'Pack', 'Other']

export default function Sales() {
  const location = useLocation()
  const [dateStr, setDateStr] = useState(() => format(Date.now(), 'yyyy-MM-dd'))
  const [formOpen, setFormOpen] = useState(true)
  const [focusToken, setFocusToken] = useState(0)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')

  const dayStart = startOfDay(new Date(dateStr).getTime())
  const dayEnd = endOfDay(new Date(dateStr).getTime())

  // The floating "+" button navigates here with a fresh state.record value
  // each time, so it reliably reopens/refocuses the form even if we're
  // already on this page.
  useEffect(() => {
    const record = (location.state as { record?: number } | null)?.record
    if (record) {
      setFormOpen(true)
      setFocusToken(record)
    }
  }, [location.state])

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

  async function deleteSale(sale: Sale) {
    await db.transaction('rw', db.sales, db.items, async () => {
      await db.sales.delete(sale.id!)
      const stockWasDeducted = !sale.tbs || sale.pickedUp
      if (stockWasDeducted && sale.itemId) {
        const item = await db.items.get(sale.itemId)
        if (item) await db.items.update(sale.itemId, { stock: item.stock + sale.qty, updatedAt: Date.now() })
      }
    })
  }

  async function markPickedUp(sale: Sale) {
    await db.transaction('rw', db.sales, db.items, async () => {
      await db.sales.update(sale.id!, { pickedUp: true })
      if (sale.itemId) {
        const item = await db.items.get(sale.itemId)
        if (item) await db.items.update(sale.itemId, { stock: Math.max(0, item.stock - sale.qty), updatedAt: Date.now() })
      }
    })
  }

  function startEdit(sale: Sale) {
    setEditingId(sale.id!)
    setEditValue(sale.customerName ?? '')
  }

  async function saveEdit(sale: Sale) {
    await db.sales.update(sale.id!, { customerName: editValue.trim() || undefined })
    setEditingId(null)
  }

  return (
    <div className="flex flex-col gap-5">
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

      {formOpen && <SaleForm focusToken={focusToken} />}

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
                <th className="pb-2 font-medium">Customer</th>
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
                    {editingId === s.id ? (
                      <input
                        autoFocus
                        className={inputClass + ' w-28 py-1 text-xs'}
                        value={editValue}
                        placeholder={`Customer #${s.customerNumber}`}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => saveEdit(s)}
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit(s)}
                      />
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium whitespace-nowrap">
                          {s.customerName || `Customer #${s.customerNumber}`}
                        </span>
                        <button
                          onClick={() => startEdit(s)}
                          className="text-[var(--text-muted)] hover:text-[var(--series-1)]"
                          aria-label="Rename customer"
                        >
                          <EditIcon className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <div className="font-medium">{s.itemName}</div>
                    <div className="flex items-center gap-1.5">
                      {s.variant && <span className="text-xs text-[var(--text-muted)]">{s.variant}</span>}
                      {s.tbs && !s.pickedUp && <Badge tone="warning">TBS — awaiting pickup</Badge>}
                      {s.tbs && s.pickedUp && <Badge tone="good">Picked up</Badge>}
                    </div>
                  </td>
                  <td className="tabular py-2 pr-2">
                    {s.qty}
                    {s.unitType && <span className="text-[var(--text-muted)]"> {s.unitType}</span>}
                  </td>
                  <td className="tabular py-2 pr-2">{money(s.soldFor, s.currency)}</td>
                  <td className="tabular py-2 pr-2 text-[var(--text-muted)]">{money(s.costAtSale, s.currency)}</td>
                  <td className="tabular py-2 pr-2 text-[var(--status-good)]">{money(profitOf(s), s.currency)}</td>
                  <td className="py-2 pr-2 text-[var(--text-muted)]">{formatTimeMonrovia(s.timestamp)}</td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {s.tbs && !s.pickedUp && (
                        <button
                          onClick={() => markPickedUp(s)}
                          className="whitespace-nowrap text-xs font-medium text-[var(--series-1)] hover:underline"
                        >
                          Mark picked up
                        </button>
                      )}
                      <button
                        onClick={() => deleteSale(s)}
                        className="text-[var(--text-muted)] hover:text-[var(--status-critical)]"
                        aria-label="Delete sale"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {sales?.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-sm text-[var(--text-muted)]">
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

function SaleForm({ focusToken }: { focusToken: number }) {
  const items = useLiveQuery(() => db.items.orderBy('name').toArray(), [])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Item | null>(null)
  const [qty, setQty] = useState(1)
  const [unitType, setUnitType] = useState('Piece')
  const [customUnit, setCustomUnit] = useState('')
  const [soldFor, setSoldFor] = useState<number>(0)
  const [currency, setCurrency] = useState<Currency>('USD')
  const [manualName, setManualName] = useState('')
  const [manualCost, setManualCost] = useState<number>(0)
  const [costUnknown, setCostUnknown] = useState(true)
  const [sameAsLast, setSameAsLast] = useState(false)
  const [tbs, setTbs] = useState(false)

  const qtyRef = useRef<HTMLInputElement>(null)
  const customUnitRef = useRef<HTMLInputElement>(null)
  const itemInputRef = useRef<HTMLInputElement>(null)
  const soldForRef = useRef<HTMLInputElement>(null)
  const unitChipRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    if (focusToken) {
      qtyRef.current?.focus()
      qtyRef.current?.select()
    }
  }, [focusToken])

  const nextCounterRow = useLiveQuery(() => db.settings.get(NEXT_CUSTOMER_NUMBER_KEY), [])
  const nextNumber = peekNextCustomerNumber(nextCounterRow)
  const lastSale = useLiveQuery(() => db.sales.orderBy('timestamp').last(), [])
  const previewNumber = sameAsLast && lastSale ? lastSale.customerNumber : nextNumber

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

  function chooseUnit(u: string) {
    setUnitType(u)
    if (u === 'Other') {
      setTimeout(() => customUnitRef.current?.focus(), 0)
    } else {
      setTimeout(() => itemInputRef.current?.focus(), 0)
    }
  }

  function onEnterAdvance(next: () => void) {
    return (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        next()
      }
    }
  }

  const costTotal = selected ? selected.costPrice * qty : costUnknown ? 0 : manualCost
  const profitPreview = soldFor - costTotal

  async function submit() {
    const name = selected ? selected.name : manualName.trim()
    if (!name || qty <= 0 || soldFor < 0) return

    await db.transaction('rw', db.sales, db.items, db.settings, async () => {
      const customerNumber = sameAsLast && lastSale ? lastSale.customerNumber : await reserveNextCustomerNumber()

      let itemId = selected?.id
      let itemCategory = selected?.category
      let itemVariant = selected?.variant

      // Quick sale of an item not picked from inventory: link to an existing
      // item with the same name, or create a new catalog entry for it so it
      // shows up in Inventory (flagged if the cost wasn't entered).
      if (!selected) {
        const existing = await db.items.where('name').equalsIgnoreCase(name).first()
        if (existing) {
          itemId = existing.id
          itemCategory = existing.category
          itemVariant = existing.variant
        } else {
          const now = Date.now()
          itemId = await db.items.add({
            name,
            category: 'General',
            variant: '',
            costPrice: costUnknown ? 0 : manualCost,
            costUnknown,
            sellPrice: qty > 0 ? soldFor / qty : soldFor,
            currency,
            stock: 0,
            lowStockThreshold: 3,
            createdAt: now,
            updatedAt: now,
          })
        }
      }

      await db.sales.add({
        itemId,
        itemName: name,
        category: itemCategory,
        variant: itemVariant,
        qty,
        unitType: unitType === 'Other' ? customUnit.trim() || undefined : unitType,
        soldFor,
        costAtSale: costTotal,
        currency,
        timestamp: Date.now(),
        customerNumber,
        tbs,
        pickedUp: !tbs,
      })

      if (!tbs && itemId) {
        const fresh = await db.items.get(itemId)
        if (fresh) {
          await db.items.update(itemId, {
            stock: Math.max(0, fresh.stock - qty),
            updatedAt: Date.now(),
          })
        }
      }
    })

    setSelected(null)
    setQuery('')
    setQty(1)
    setUnitType('Piece')
    setCustomUnit('')
    setSoldFor(0)
    setManualName('')
    setManualCost(0)
    setCostUnknown(true)
    setTbs(false)
    setTimeout(() => {
      qtyRef.current?.focus()
      qtyRef.current?.select()
    }, 0)
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Pill
          options={[{ label: 'USD', value: 'USD' }, { label: 'LRD', value: 'LRD' }]}
          value={currency}
          onChange={(v) => !selected && setCurrency(v)}
          className={selected ? 'opacity-50' : ''}
        />
        <div className="flex items-center gap-2">
          {lastSale && (
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <input type="checkbox" checked={sameAsLast} onChange={(e) => setSameAsLast(e.target.checked)} />
              Same as #{lastSale.customerNumber}
            </label>
          )}
          <Badge tone="good">#{previewNumber}</Badge>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Field label="Quantity">
          <input
            ref={qtyRef}
            type="number"
            inputMode="numeric"
            min={1}
            className={inputClass}
            value={qty}
            onFocus={selectOnFocus}
            onChange={(e) => changeQty(Number(e.target.value) || 1)}
            onKeyDown={onEnterAdvance(() => unitChipRefs.current[unitType]?.focus())}
            enterKeyHint="next"
          />
        </Field>

        <Field label="Unit">
          <div className="grid grid-cols-3 gap-1.5">
            {UNIT_TYPES.map((u) => (
              <button
                key={u}
                type="button"
                ref={(el) => { unitChipRefs.current[u] = el }}
                onClick={() => chooseUnit(u)}
                onKeyDown={onEnterAdvance(() => chooseUnit(u))}
                className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                  unitType === u
                    ? 'border-[var(--series-1)] bg-[var(--series-1)] text-white'
                    : 'border-[var(--border)] bg-[var(--page-plane)] text-[var(--text-secondary)]'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
          {unitType === 'Other' && (
            <input
              ref={customUnitRef}
              className={inputClass + ' mt-1.5'}
              placeholder="Custom unit"
              value={customUnit}
              onChange={(e) => setCustomUnit(e.target.value)}
              onKeyDown={onEnterAdvance(() => itemInputRef.current?.focus())}
              enterKeyHint="next"
            />
          )}
        </Field>

        <Field label="Item">
          <div className="relative flex items-center gap-2">
            {selected && <ItemThumb image={selected.image} size={36} />}
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                ref={itemInputRef}
                className={inputClass + ' pl-9'}
                placeholder="Search inventory or type a new item name"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelected(null)
                  setManualName(e.target.value)
                }}
                onKeyDown={onEnterAdvance(() => soldForRef.current?.focus())}
                enterKeyHint="next"
              />
            {query && !selected && filtered.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-lg">
                {filtered.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => pick(it)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--page-plane)]"
                  >
                    <ItemThumb image={it.image} size={28} />
                    <span className="flex-1">{it.name}</span>
                    <span className="tabular text-xs text-[var(--text-muted)]">{it.stock} in stock</span>
                  </button>
                ))}
              </div>
            )}
            </div>
          </div>
          {!selected && query && (
            <span className="text-xs text-[var(--text-muted)]">Not in inventory — will be added as a new item.</span>
          )}
        </Field>

        <Field label="Sold for (total)">
          <input
            ref={soldForRef}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className={inputClass}
            value={soldFor}
            onFocus={selectOnFocus}
            onChange={(e) => setSoldFor(Number(e.target.value) || 0)}
            onKeyDown={onEnterAdvance(() => submit())}
            enterKeyHint="done"
          />
        </Field>

        {!selected && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--page-plane)] p-2.5">
            <Switch checked={costUnknown} onChange={setCostUnknown} label="I don't know the cost yet" />
            {!costUnknown && (
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder="Cost (total)"
                className={inputClass + ' w-36'}
                value={manualCost}
                onFocus={selectOnFocus}
                onChange={(e) => setManualCost(Number(e.target.value) || 0)}
              />
            )}
          </div>
        )}

        <Switch checked={tbs} onChange={setTbs} label="TBS — customer paid, will pick up goods later" />
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
