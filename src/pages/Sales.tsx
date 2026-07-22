import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Currency, type Sale } from '../db'
import { Card, Button, inputClass, Badge } from '../components/ui'
import { PlusIcon, TrashIcon, EditIcon, SearchIcon } from '../components/icons'
import { useAppActions } from '../context/AppActions'
import { money, dateKeyMonrovia, formatDateMonrovia, formatTimeMonrovia } from '../lib/format'

type FilterTab = 'all' | 'tbs'

interface OrderGroup {
  orderNumber: number
  timestamp: number
  customerNumber: number
  customerName?: string
  lines: Sale[]
  totals: Partial<Record<Currency, number>>
  anyTbs: boolean
}

function customerLabelOf(order: Pick<OrderGroup, 'customerNumber' | 'customerName'>): string {
  return order.customerName || `Customer ${String(order.customerNumber).padStart(3, '0')}`
}

function formatCurrencyTotals(totals: Partial<Record<Currency, number>>): string {
  const parts = (Object.entries(totals) as [Currency, number][])
    .filter(([, amt]) => amt !== 0)
    .map(([cur, amt]) => money(amt, cur))
  return parts.length > 0 ? parts.join(' + ') : money(0, 'USD')
}

export default function Sales() {
  const { openRecordSale } = useAppActions()
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [expandedOrderNumber, setExpandedOrderNumber] = useState<number | null>(null)
  const [editingOrderNumber, setEditingOrderNumber] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')

  const allSales = useLiveQuery(() => db.sales.orderBy('timestamp').reverse().toArray(), [])

  const orders = useMemo(() => {
    const map = new Map<number, Sale[]>()
    for (const s of allSales ?? []) {
      const list = map.get(s.orderNumber) ?? []
      list.push(s)
      map.set(s.orderNumber, list)
    }
    const groups: OrderGroup[] = Array.from(map.entries()).map(([orderNumber, lines]) => {
      const totals: Partial<Record<Currency, number>> = {}
      for (const l of lines) totals[l.currency] = (totals[l.currency] ?? 0) + l.soldFor
      return {
        orderNumber,
        timestamp: lines[0].timestamp,
        customerNumber: lines[0].customerNumber,
        customerName: lines.find((l) => l.customerName)?.customerName,
        lines,
        totals,
        anyTbs: lines.some((l) => l.tbs),
      }
    })
    groups.sort((a, b) => b.timestamp - a.timestamp)
    return groups
  }, [allSales])

  const filteredOrders = useMemo(() => {
    let list = orders
    if (filterTab === 'tbs') list = list.filter((o) => o.anyTbs)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((o) => {
        if (customerLabelOf(o).toLowerCase().includes(q)) return true
        if (String(o.orderNumber).includes(q)) return true
        return o.lines.some((l) => l.itemName.toLowerCase().includes(q))
      })
    }
    return list
  }, [orders, filterTab, searchQuery])

  const groupedByDate = useMemo(() => {
    const map = new Map<string, { label: string; orders: OrderGroup[] }>()
    for (const o of filteredOrders) {
      const key = dateKeyMonrovia(o.timestamp)
      if (!map.has(key)) map.set(key, { label: formatDateMonrovia(o.timestamp), orders: [] })
      map.get(key)!.orders.push(o)
    }
    return Array.from(map.values())
  }, [filteredOrders])

  async function deleteSale(sale: Sale) {
    await db.transaction('rw', db.sales, db.variants, async () => {
      await db.sales.delete(sale.id!)
      const stockWasDeducted = !sale.tbs || sale.pickedUp
      if (stockWasDeducted && sale.variantId) {
        const variant = await db.variants.get(sale.variantId)
        if (variant) await db.variants.update(sale.variantId, { stockMyShop: variant.stockMyShop + sale.qty, updatedAt: Date.now() })
      }
    })
  }

  async function markPickedUp(sale: Sale) {
    await db.transaction('rw', db.sales, db.variants, async () => {
      await db.sales.update(sale.id!, { pickedUp: true })
      if (sale.variantId) {
        const variant = await db.variants.get(sale.variantId)
        if (variant) await db.variants.update(sale.variantId, { stockMyShop: Math.max(0, variant.stockMyShop - sale.qty), updatedAt: Date.now() })
      }
    })
  }

  function startEdit(order: OrderGroup) {
    setEditingOrderNumber(order.orderNumber)
    setEditValue(order.customerName ?? '')
  }

  async function saveEdit(order: OrderGroup) {
    const name = editValue.trim() || undefined
    await db.transaction('rw', db.sales, async () => {
      for (const line of order.lines) {
        await db.sales.update(line.id!, { customerName: name })
      }
    })
    setEditingOrderNumber(null)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Sales</h1>
        <Button onClick={openRecordSale}>
          <PlusIcon className="h-4 w-4" />
          Record sale
        </Button>
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          className={inputClass + ' pl-9'}
          placeholder="Search orders, items, or customers"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {(['all', 'tbs'] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilterTab(tab)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              filterTab === tab
                ? 'border-[var(--series-1)] bg-[var(--series-1)] text-white'
                : 'border-[var(--border)] bg-[var(--page-plane)] text-[var(--text-secondary)]'
            }`}
          >
            {tab === 'all' ? 'All' : 'TBS'}
          </button>
        ))}
        <button
          type="button"
          title="More filters coming soon"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--page-plane)] text-[var(--text-muted)]"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {groupedByDate.map((group) => (
          <div key={group.label}>
            <div className="mb-2 px-1 text-xs font-semibold text-[var(--text-muted)]">{group.label}</div>
            <div className="flex flex-col gap-2">
              {group.orders.map((order) => {
                const expanded = expandedOrderNumber === order.orderNumber
                const label = customerLabelOf(order)
                const itemCount = order.lines.length
                const anyPendingPickup = order.lines.some((l) => l.tbs && !l.pickedUp)
                const anyPickedUp = order.lines.some((l) => l.tbs && l.pickedUp)

                return (
                  <Card key={order.orderNumber} className="py-3">
                    <button className="w-full text-left" onClick={() => setExpandedOrderNumber(expanded ? null : order.orderNumber)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 font-semibold">#{order.orderNumber}</div>
                        <div className="tabular shrink-0 text-right text-base font-bold">{formatCurrencyTotals(order.totals)}</div>
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-1 text-sm text-[var(--text-muted)]">
                        {editingOrderNumber === order.orderNumber ? (
                          <input
                            autoFocus
                            className={inputClass + ' w-32 shrink-0 py-1 text-xs'}
                            value={editValue}
                            placeholder={`Customer ${String(order.customerNumber).padStart(3, '0')}`}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveEdit(order)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEdit(order)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <>
                            <span className="shrink-0 truncate font-medium text-[var(--text-secondary)]">{label}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                startEdit(order)
                              }}
                              className="shrink-0 text-[var(--text-muted)] hover:text-[var(--series-1)]"
                              aria-label="Rename customer"
                            >
                              <EditIcon className="h-3 w-3" />
                            </button>
                          </>
                        )}
                        <span className="truncate">
                          · {itemCount} item{itemCount === 1 ? '' : 's'} · {formatTimeMonrovia(order.timestamp)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {!order.anyTbs && <Badge tone="muted">Delivered</Badge>}
                        {anyPendingPickup && <Badge tone="warning">TBS — awaiting pickup</Badge>}
                        {anyPickedUp && !anyPendingPickup && <Badge tone="good">Picked up</Badge>}
                      </div>
                    </button>

                    {expanded && (
                      <div className="mt-3 flex flex-col gap-2.5 border-t border-[var(--gridline)] pt-3">
                        {order.lines.map((line) => (
                          <div key={line.id} className="flex items-start justify-between gap-2 text-sm">
                            <div className="min-w-0">
                              <div className="truncate font-medium">{line.itemName}</div>
                              <div className="tabular text-xs text-[var(--text-muted)]">
                                {line.variant && `${line.variant} · `}
                                {line.qty}
                                {line.unitType && ` ${line.unitType}`} · {money(line.soldFor, line.currency)}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {line.tbs && !line.pickedUp && (
                                <button
                                  onClick={() => markPickedUp(line)}
                                  className="whitespace-nowrap text-xs font-medium text-[var(--series-1)] hover:underline"
                                >
                                  Mark picked up
                                </button>
                              )}
                              <button
                                onClick={() => deleteSale(line)}
                                className="text-[var(--text-muted)] hover:text-[var(--status-critical)]"
                                aria-label="Delete item"
                              >
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          </div>
        ))}
        {groupedByDate.length === 0 && (
          <Card>
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">
              No sales match yet. Tap "Record sale" to add your first one.
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
