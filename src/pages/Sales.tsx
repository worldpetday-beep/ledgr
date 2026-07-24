import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, releaseOrderNumberIfLatest, type Sale } from '../db'
import { ShopifyShell, ShopifyHeaderIconButton, shopifyInputClass, shopifyChipClass, shopifyCardClass } from '../components/ShopifyShell'
import { PlusIcon, EditIcon, SearchIcon, MoreVerticalIcon, BoxesIcon, BookIcon } from '../components/icons'
import { DaybookRow } from '../components/DaybookRow'
import { BookTabView } from '../components/BookTab'
import { WarehouseLedgerView } from '../components/WarehouseLedger'
import { BottomSheet, Field } from '../components/ui'
import { useAppActions } from '../context/AppActions'
import { money, dateKeyMonrovia, formatDateMonrovia, formatTimeMonrovia, selectOnFocus } from '../lib/format'
import { lrdAmountOf, usdAmountOf, customerLabelOf } from '../lib/salesLedger'

type FilterTab = 'all' | 'tbs'

interface OrderGroup {
  orderNumber: number
  timestamp: number
  customerNumber: number
  customerName?: string
  lines: Sale[]
  anyTbs: boolean
}

function statusBadge(text: string, tone: 'muted' | 'warning' | 'good') {
  const styles: Record<string, string> = {
    muted: 'bg-gray-100 text-gray-600',
    warning: 'bg-amber-100 text-amber-700',
    good: 'bg-green-100 text-green-700',
  }
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[tone]}`}>{text}</span>
}

export default function Sales() {
  const { openRecordSale } = useAppActions()
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [editingOrderNumber, setEditingOrderNumber] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [bookTabOpen, setBookTabOpen] = useState(false)
  const [warehouseLedgerOpen, setWarehouseLedgerOpen] = useState(false)

  const todayKey = dateKeyMonrovia(Date.now())
  const allSales = useLiveQuery(() => db.sales.orderBy('timestamp').reverse().toArray(), [])
  const todaySales = useMemo(() => (allSales ?? []).filter((s) => dateKeyMonrovia(s.timestamp) === todayKey), [allSales, todayKey])

  // Single-day isolated view — no infinite historical scroll here; past
  // days live in the Book Tab archive instead.
  const orders = useMemo(() => {
    const map = new Map<number, Sale[]>()
    for (const s of todaySales) {
      const list = map.get(s.orderNumber) ?? []
      list.push(s)
      map.set(s.orderNumber, list)
    }
    const groups: OrderGroup[] = Array.from(map.entries()).map(([orderNumber, lines]) => ({
      orderNumber,
      timestamp: lines[0].timestamp,
      customerNumber: lines[0].customerNumber,
      customerName: lines.find((l) => l.customerName)?.customerName,
      lines,
      anyTbs: lines.some((l) => l.tbs),
    }))
    groups.sort((a, b) => b.timestamp - a.timestamp)
    return groups
  }, [todaySales])

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

  const ledgerSumUsd = useMemo(() => todaySales.reduce((s, l) => s + usdAmountOf(l), 0), [todaySales])
  const ledgerSumLrd = useMemo(() => todaySales.reduce((s, l) => s + lrdAmountOf(l), 0), [todaySales])

  const drawerCounts = useLiveQuery(() => db.drawerCounts.orderBy('timestamp').reverse().toArray(), [])
  const yesterdayClose = useMemo(() => (drawerCounts ?? []).find((d) => dateKeyMonrovia(d.timestamp) !== todayKey), [drawerCounts, todayKey])

  const [drawerUsd, setDrawerUsd] = useState('')
  const [drawerLrd, setDrawerLrd] = useState('')
  const [outboundUsd, setOutboundUsd] = useState('')
  const [outboundLrd, setOutboundLrd] = useState('')
  const [eodNote, setEodNote] = useState('')

  const finalHandCashUsd = (yesterdayClose?.usdActual ?? 0) + ledgerSumUsd - (Number(outboundUsd) || 0)
  const finalHandCashLrd = (yesterdayClose?.lrdActual ?? 0) + ledgerSumLrd - (Number(outboundLrd) || 0)

  async function logDayEndCount() {
    await db.drawerCounts.add({
      timestamp: Date.now(),
      usdActual: Number(drawerUsd) || 0,
      lrdActual: Number(drawerLrd) || 0,
      outboundUsd: Number(outboundUsd) || 0,
      outboundLrd: Number(outboundLrd) || 0,
      note: eodNote.trim() || undefined,
    })
    setDrawerUsd('')
    setDrawerLrd('')
    setOutboundUsd('')
    setOutboundLrd('')
    setEodNote('')
  }

  async function deleteSale(sale: Sale) {
    await db.transaction('rw', db.sales, db.variants, db.settings, async () => {
      await db.sales.delete(sale.id!)
      const stockWasDeducted = !sale.tbs || sale.pickedUp
      if (stockWasDeducted && sale.variantId) {
        const variant = await db.variants.get(sale.variantId)
        if (variant) {
          const updated =
            sale.location === 'vishalShop'
              ? { stockVishalShop: variant.stockVishalShop + sale.qty }
              : { stockMyShop: variant.stockMyShop + sale.qty }
          await db.variants.update(sale.variantId, { ...updated, updatedAt: Date.now() })
        }
      }
    })
    // Strict order-ID sequence recycler: if that was the last line of the
    // most-recently-issued order, the next new sale reuses this exact number.
    await releaseOrderNumberIfLatest(sale.orderNumber)
  }

  async function markPickedUp(sale: Sale) {
    await db.transaction('rw', db.sales, db.variants, async () => {
      await db.sales.update(sale.id!, { pickedUp: true })
      if (sale.variantId) {
        const variant = await db.variants.get(sale.variantId)
        if (variant) {
          const updated =
            sale.location === 'vishalShop'
              ? { stockVishalShop: Math.max(0, variant.stockVishalShop - sale.qty) }
              : { stockMyShop: Math.max(0, variant.stockMyShop - sale.qty) }
          await db.variants.update(sale.variantId, { ...updated, updatedAt: Date.now() })
        }
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
    <ShopifyShell
      title="Sales"
      headerRight={
        <>
          <ShopifyHeaderIconButton onClick={openRecordSale} label="Record sale">
            <PlusIcon className="h-5 w-5" />
          </ShopifyHeaderIconButton>
          <ShopifyHeaderIconButton onClick={() => setMoreMenuOpen(true)} label="More options">
            <MoreVerticalIcon className="h-5 w-5" />
          </ShopifyHeaderIconButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            className={shopifyInputClass + ' pl-9'}
            placeholder="Search today's orders, items, or customers"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {(['all', 'tbs'] as FilterTab[]).map((tab) => (
            <button key={tab} onClick={() => setFilterTab(tab)} className={shopifyChipClass(filterTab === tab)}>
              {tab === 'all' ? 'All' : 'TBS'}
            </button>
          ))}
        </div>

        <div className="px-1 text-xs font-semibold text-gray-500">{formatDateMonrovia(Date.now())} — today's ledger</div>

        <div className="flex flex-col gap-3">
          {filteredOrders.map((order) => {
            const label = customerLabelOf(order)
            const itemCount = order.lines.length
            const anyPendingPickup = order.lines.some((l) => l.tbs && !l.pickedUp)
            const anyPickedUp = order.lines.some((l) => l.tbs && l.pickedUp)

            return (
              <div key={order.orderNumber} className={shopifyCardClass}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1 text-sm text-gray-500">
                    <span className="shrink-0 font-semibold text-black">#{order.orderNumber}</span>
                    {editingOrderNumber === order.orderNumber ? (
                      <input
                        autoFocus
                        className={shopifyInputClass + ' w-32 shrink-0 py-1 text-xs'}
                        value={editValue}
                        placeholder={`Customer ${String(order.customerNumber).padStart(3, '0')}`}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => saveEdit(order)}
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit(order)}
                      />
                    ) : (
                      <>
                        <span className="shrink-0 truncate">· {label}</span>
                        <button onClick={() => startEdit(order)} className="shrink-0 text-gray-400 hover:text-black" aria-label="Rename customer">
                          <EditIcon className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                  <div className="shrink-0 text-xs text-gray-400">{formatTimeMonrovia(order.timestamp)}</div>
                </div>

                <div className="mt-1 flex flex-wrap gap-1.5">
                  {!order.anyTbs && statusBadge('Delivered', 'muted')}
                  {anyPendingPickup && statusBadge('TBS — awaiting pickup', 'warning')}
                  {anyPickedUp && !anyPendingPickup && statusBadge('Picked up', 'good')}
                  <span className="text-xs text-gray-400">
                    {itemCount} item{itemCount === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="mt-1.5 divide-y divide-gray-100">
                  {order.lines.map((line) => (
                    <DaybookRow key={line.id} sale={line} onDelete={() => deleteSale(line)} onMarkPickedUp={() => markPickedUp(line)} />
                  ))}
                </div>
              </div>
            )
          })}
          {filteredOrders.length === 0 && (
            <div className={shopifyCardClass}>
              <p className="py-8 text-center text-sm text-gray-500">
                No sales recorded today yet. Tap the + above to add your first one.
              </p>
            </div>
          )}
        </div>

        <div className={shopifyCardClass}>
          <h2 className="mb-3 text-sm font-semibold text-black">End-of-day balance</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <div className="text-gray-500">Ledger sales — USD</div>
            <div className="tabular text-right font-semibold text-black">{money(ledgerSumUsd, 'USD')}</div>
            <div className="text-gray-500">Ledger sales — LRD</div>
            <div className="tabular text-right font-semibold text-black">{money(ledgerSumLrd, 'LRD')}</div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Drawer cash — USD">
              <input
                type="number"
                min={0}
                step="0.01"
                className={shopifyInputClass}
                value={drawerUsd}
                onFocus={selectOnFocus}
                onChange={(e) => setDrawerUsd(e.target.value)}
              />
            </Field>
            <Field label="Drawer cash — LRD">
              <input
                type="number"
                min={0}
                step="0.01"
                className={shopifyInputClass}
                value={drawerLrd}
                onFocus={selectOnFocus}
                onChange={(e) => setDrawerLrd(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Outbound — USD">
              <input
                type="number"
                min={0}
                step="0.01"
                className={shopifyInputClass}
                value={outboundUsd}
                onFocus={selectOnFocus}
                onChange={(e) => setOutboundUsd(e.target.value)}
              />
            </Field>
            <Field label="Outbound — LRD">
              <input
                type="number"
                min={0}
                step="0.01"
                className={shopifyInputClass}
                value={outboundLrd}
                onFocus={selectOnFocus}
                onChange={(e) => setOutboundLrd(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-3 border-t border-gray-100 pt-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <div className="text-gray-500">Final hand cash — USD</div>
              <div className="tabular text-right text-base font-bold text-black">{money(finalHandCashUsd, 'USD')}</div>
              <div className="text-gray-500">Final hand cash — LRD</div>
              <div className="tabular text-right text-base font-bold text-black">{money(finalHandCashLrd, 'LRD')}</div>
            </div>
            {yesterdayClose && (
              <p className="mt-2 text-xs text-gray-400">
                Carries forward {money(yesterdayClose.usdActual, 'USD')} + {money(yesterdayClose.lrdActual, 'LRD')} counted on{' '}
                {formatDateMonrovia(yesterdayClose.timestamp)}.
              </p>
            )}
          </div>

          <input
            className={shopifyInputClass + ' mt-3'}
            placeholder="Note (optional)"
            value={eodNote}
            onChange={(e) => setEodNote(e.target.value)}
          />
          <button onClick={logDayEndCount} className="mt-3 w-full rounded-lg bg-black py-2.5 text-sm font-semibold text-white">
            Log day-end count
          </button>
        </div>
      </div>

      <BottomSheet open={moreMenuOpen} onClose={() => setMoreMenuOpen(false)} contentClassName="!bg-white !text-black">
        <div className="flex flex-col gap-1 pt-2">
          <h2 className="px-1 pb-2 text-sm font-semibold text-gray-500">More options</h2>
          <button
            onClick={() => {
              setMoreMenuOpen(false)
              setBookTabOpen(true)
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-black hover:bg-gray-50"
          >
            <BookIcon className="h-5 w-5 text-gray-500" />
            Book Tab — daily archive
          </button>
          <button
            onClick={() => {
              setMoreMenuOpen(false)
              setWarehouseLedgerOpen(true)
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-black hover:bg-gray-50"
          >
            <BoxesIcon className="h-5 w-5 text-gray-500" />
            Warehouse Ledger
          </button>
        </div>
      </BottomSheet>

      {bookTabOpen && <BookTabView onClose={() => setBookTabOpen(false)} />}
      {warehouseLedgerOpen && <WarehouseLedgerView onClose={() => setWarehouseLedgerOpen(false)} />}
    </ShopifyShell>
  )
}
