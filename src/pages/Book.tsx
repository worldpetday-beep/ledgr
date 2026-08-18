import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, type Sale } from '../db'
import { EditIcon, SearchIcon, MoreVerticalIcon, BoxesIcon, ScanIcon } from '../components/icons'
import { LedgerScanView } from '../components/LedgerScan'
import { WarehouseLedgerView } from '../components/WarehouseLedger'
import { InvoicePopup } from '../components/InvoicePopup'
import { dateKeyMonrovia, formatShortDateMonrovia, formatTimeMonrovia } from '../lib/format'
import { customerLabelOf, deleteSaleLine, markSalePickedUp, withoutVoided } from '../lib/salesLedger'

type FilterTab = 'all' | 'tbs'
const DAY_MS = 24 * 60 * 60 * 1000

function dayLabel(key: string): string {
  const today = dateKeyMonrovia(Date.now())
  if (key === today) return 'Today'
  if (key === dateKeyMonrovia(Date.now() - DAY_MS)) return 'Yesterday'
  return formatShortDateMonrovia(new Date(`${key}T12:00:00`).getTime())
}

interface OrderGroup {
  orderNumber: number
  timestamp: number
  customerNumber: number
  customerName?: string
  lines: Sale[]
  anyTbs: boolean
  total: number
}

// Sales grouped by day, newest first -- matches the reference Book screen:
// a chip filter (Everything / TBS), each day gets a header with its total,
// each order is an `.entry` card with pills for status, a GIVE-equivalent
// (mark picked up) inline on pending TBS lines, and a VOID action that
// reuses the app's existing non-destructive delete (deleteSaleLine already
// soft-deletes via voidedAt, so this already matches the reference's
// void/restore model -- nothing here erases a row).
export default function Book() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [editingOrderNumber, setEditingOrderNumber] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [warehouseLedgerOpen, setWarehouseLedgerOpen] = useState(false)
  const [picker, setPicker] = useState(false)

  const allSalesRaw = useLiveQuery(() => db.sales.orderBy('timestamp').reverse().toArray(), [])
  const allSales = useMemo(() => withoutVoided(allSalesRaw ?? []), [allSalesRaw])

  const orders = useMemo(() => {
    const map = new Map<number, Sale[]>()
    for (const s of allSales) {
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
      total: lines.reduce((s, l) => s + l.soldFor + (l.secondaryAmount ?? 0), 0),
    }))
    groups.sort((a, b) => b.timestamp - a.timestamp)
    return groups
  }, [allSales])

  const filtered = useMemo(() => {
    let list = orders
    if (filterTab === 'tbs') list = list.filter((o) => o.anyTbs)
    if (q.trim()) {
      const t = q.toLowerCase()
      list = list.filter((o) => {
        if (customerLabelOf(o).toLowerCase().includes(t)) return true
        if (String(o.orderNumber).includes(t)) return true
        return o.lines.some((l) => l.itemName.toLowerCase().includes(t))
      })
    }
    return list
  }, [orders, filterTab, q])

  const days = useMemo(() => {
    const grouped = new Map<string, OrderGroup[]>()
    for (const o of filtered) {
      const key = dateKeyMonrovia(o.timestamp)
      const list = grouped.get(key) ?? []
      list.push(o)
      grouped.set(key, list)
    }
    return Array.from(grouped.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [filtered])

  const [invoiceOrderNumber, setInvoiceOrderNumber] = useState<number | null>(null)
  const invoiceOrder = useMemo(
    () => (invoiceOrderNumber != null ? orders.find((o) => o.orderNumber === invoiceOrderNumber) ?? null : null),
    [orders, invoiceOrderNumber],
  )
  const dailyIndexByOrder = useMemo(() => {
    const chronological = [...orders].sort((a, b) => a.timestamp - b.timestamp)
    const map = new Map<number, number>()
    chronological.forEach((o, i) => map.set(o.orderNumber, i + 1))
    return map
  }, [orders])

  function startEdit(order: OrderGroup) {
    setEditingOrderNumber(order.orderNumber)
    setEditValue(order.customerName ?? '')
  }
  async function saveEdit(order: OrderGroup) {
    const name = editValue.trim() || undefined
    await db.transaction('rw', db.sales, async () => {
      for (const line of order.lines) await db.sales.update(line.id!, { customerName: name })
    })
    setEditingOrderNumber(null)
  }

  return (
    <div className="cl flex min-h-[calc(100dvh-6rem)] flex-col md:min-h-[calc(100dvh-2rem)]">
      <div className="hd">
        <div>
          <h1>Book</h1>
          <div className="sub">{orders.length} entries</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn-s hot" onClick={() => setPicker(true)}>+ Fill a past day</button>
          <button className="btn-s" onClick={() => setMoreMenuOpen(true)} aria-label="More options">
            <MoreVerticalIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="srch">
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--cl-ink-3)' }}>
            <SearchIcon className="h-4 w-4" />
          </span>
          <input style={{ paddingLeft: 38 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search orders, items, customers…" />
        </div>
      </div>

      <div className="body">
        <div className="pad">
          <div className="chips" style={{ paddingTop: 4 }}>
            <button className={filterTab === 'all' ? 'on' : ''} onClick={() => setFilterTab('all')}>Everything</button>
            <button className={filterTab === 'tbs' ? 'on' : ''} onClick={() => setFilterTab('tbs')}>To be supplied</button>
          </div>

          {!days.length && (
            <div className="empty">
              <b>Nothing here yet</b>
              <span>Record a sale in Sell, or tap "Fill a past day" to catch up on a day you missed.</span>
            </div>
          )}

          {days.map(([key, ss]) => (
            <div key={key}>
              <div className="day">
                <span className="d">{dayLabel(key)}</span>
                <span className="t m">{ss.reduce((s, o) => s + o.total, 0).toFixed(2)}</span>
              </div>
              {ss.map((order) => {
                const label = customerLabelOf(order)
                const anyPendingPickup = order.lines.some((l) => l.tbs && !l.pickedUp)
                const anyPickedUp = order.lines.some((l) => l.tbs && l.pickedUp)
                return (
                  <div key={order.orderNumber} className="entry">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <span className="m" style={{ fontSize: 16, fontWeight: 700 }}>{order.total.toFixed(2)}</span>
                      <span style={{ display: 'flex', gap: 5 }}>
                        {anyPendingPickup && <span className="pill amber">tbs</span>}
                        {anyPickedUp && !anyPendingPickup && <span className="pill grey">picked up</span>}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 12, fontWeight: 700 }}>
                      <span>#{order.orderNumber}</span>
                      {editingOrderNumber === order.orderNumber ? (
                        <input
                          autoFocus
                          className="in"
                          style={{ padding: '4px 8px', fontSize: 12, width: 140 }}
                          value={editValue}
                          placeholder={`Customer ${String(order.customerNumber).padStart(3, '0')}`}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => saveEdit(order)}
                          onKeyDown={(e) => e.key === 'Enter' && saveEdit(order)}
                        />
                      ) : (
                        <>
                          <span>· {label}</span>
                          <button onClick={() => startEdit(order)} aria-label="Rename customer" style={{ color: 'var(--cl-ink-3)' }}>
                            <EditIcon className="h-3 w-3" />
                          </button>
                        </>
                      )}
                      <span style={{ marginLeft: 'auto', fontWeight: 500, color: 'var(--cl-ink-3)' }}>{formatTimeMonrovia(order.timestamp)}</span>
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--cl-ink-2)', lineHeight: 1.5, marginTop: 4 }}>
                      {order.lines.map((l, i) => (
                        <span key={l.id}>
                          {i > 0 && ' · '}{l.qty} {l.itemName}
                          {l.tbs && !l.pickedUp && (
                            <button
                              onClick={() => markSalePickedUp(l)}
                              style={{ marginLeft: 5, border: 0, background: 'var(--cl-amber)', borderRadius: 6, padding: '1px 6px', font: '700 9px Archivo', cursor: 'pointer', color: 'var(--cl-ink)' }}
                            >
                              GIVE
                            </button>
                          )}
                        </span>
                      ))}
                    </div>

                    <div className="m" style={{ fontSize: 11, marginTop: 7, color: 'var(--cl-ink-3)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <button onClick={() => setInvoiceOrderNumber(order.orderNumber)} style={{ color: 'var(--cl-ink-3)', textDecoration: 'underline' }}>
                        View invoice
                      </button>
                      <button
                        onClick={() => order.lines.forEach((l) => deleteSaleLine(l))}
                        style={{ border: 0, background: 'none', color: 'var(--cl-ink-3)', font: '700 10px Archivo', cursor: 'pointer' }}
                      >
                        VOID
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {picker && (
        <div className="sheet" onClick={() => setPicker(false)}>
          <div className="sbox" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <div className="scroll" style={{ paddingBottom: 16 }}>
              <p className="eb">Which day did you miss?</p>
              {Array.from({ length: 14 }, (_, i) => dateKeyMonrovia(Date.now() - i * DAY_MS)).map((key) => (
                <button
                  key={key}
                  className="btn ghost"
                  style={{ marginBottom: 8, textAlign: 'left', letterSpacing: 0, textTransform: 'none', fontSize: 14 }}
                  onClick={() => navigate('/', { state: { presetDate: key } })}
                >
                  {dayLabel(key)}
                  <span className="m" style={{ color: 'var(--cl-ink-3)', fontWeight: 500, marginLeft: 8 }}>{key}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {moreMenuOpen && (
        <div className="sheet" onClick={() => setMoreMenuOpen(false)}>
          <div className="sbox" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <div className="scroll" style={{ paddingBottom: 16 }}>
              <p className="eb">More options</p>
              <button
                className="btn ghost"
                style={{ marginBottom: 8, justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', letterSpacing: 0, textTransform: 'none', fontSize: 14 }}
                onClick={() => { setMoreMenuOpen(false); setScanOpen(true) }}
              >
                <ScanIcon className="h-4 w-4" /> Upload Ledger Image
              </button>
              <button
                className="btn ghost"
                style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', letterSpacing: 0, textTransform: 'none', fontSize: 14 }}
                onClick={() => { setMoreMenuOpen(false); setWarehouseLedgerOpen(true) }}
              >
                <BoxesIcon className="h-4 w-4" /> Warehouse Ledger
              </button>
            </div>
          </div>
        </div>
      )}

      {scanOpen && <LedgerScanView onClose={() => setScanOpen(false)} />}
      {warehouseLedgerOpen && <WarehouseLedgerView onClose={() => setWarehouseLedgerOpen(false)} />}
      <InvoicePopup
        order={invoiceOrder}
        dailyIndex={invoiceOrder ? dailyIndexByOrder.get(invoiceOrder.orderNumber) ?? 1 : 1}
        onClose={() => setInvoiceOrderNumber(null)}
      />
    </div>
  )
}
