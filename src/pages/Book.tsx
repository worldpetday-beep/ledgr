import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, EXCHANGE_RATE_KEY, DEFAULT_EXCHANGE_RATE, type Currency, type Sale } from '../db'
import { EditIcon, SearchIcon, MoreVerticalIcon, BoxesIcon, ScanIcon } from '../components/icons'
import { LedgerScanView } from '../components/LedgerScan'
import { WarehouseLedgerView } from '../components/WarehouseLedger'
import { InvoicePopup } from '../components/InvoicePopup'
import { dateKeyMonrovia, formatShortDateMonrovia, formatTimeMonrovia, money } from '../lib/format'
import { collectPayment, customerLabelOf, deleteSaleLine, markSalePickedUp, owingOf, paidPairOf, withoutVoided } from '../lib/salesLedger'
import { convertAmount } from '../lib/sellUnits'
import { loadActiveDate, storeActiveDate } from '../lib/activeDate'
import { DateCalendarPicker } from '../components/DateCalendarPicker'

type FilterTab = 'all' | 'tbs' | 'owing'
const DAY_MS = 24 * 60 * 60 * 1000

// Three small shortcuts, plus the calendar (From/To) for anything else --
// so Book opens onto something scannable instead of every sale ever
// recorded, without a long chip row of relative ranges to choose from.
type RangeTab = 'today' | 'week' | 'month'
const RANGE_OPTIONS: { value: RangeTab; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
]
function rangeStart(range: RangeTab): number {
  const todayStart = new Date(dateKeyMonrovia(Date.now()) + 'T00:00:00').getTime()
  switch (range) {
    case 'today': return todayStart
    case 'week': return todayStart - 6 * DAY_MS
    case 'month': return todayStart - 29 * DAY_MS
  }
}

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
  // The pair, exactly as typed/paid -- never merged into one number, both
  // fields always shown even when one is zero.
  paidUsd: number
  paidLrd: number
  owing: number
  currency: Currency
  rateAtSale?: number
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
  const [rangeTab, setRangeTab] = useState<RangeTab>('today')
  // Picking exact dates (via the two calendar inputs) overrides the range
  // chips entirely -- "show me June 4th through June 10th" instead of only
  // being able to pick from Today/Yesterday/7d/30d/All. A single date is
  // just a range where from === to. Starts on whatever day is active in
  // Sell/Drawer (skipped when that's just today, since the default "Today"
  // chip already covers that) so backdated work stays lined up walking
  // between tabs instead of having to re-pick the date in each one.
  const [pickedFrom, setPickedFromState] = useState<string | null>(() => {
    const active = loadActiveDate()
    return active && active !== dateKeyMonrovia(Date.now()) ? active : null
  })
  const [pickedTo, setPickedTo] = useState<string | null>(null)
  const [fromCalendarOpen, setFromCalendarOpen] = useState(false)
  const [toCalendarOpen, setToCalendarOpen] = useState(false)
  const pickedRange = pickedFrom ? { from: pickedFrom, to: pickedTo ?? pickedFrom } : null
  function setPickedFrom(key: string | null) {
    setPickedFromState(key)
    if (key) storeActiveDate(key)
  }
  function clearPickedRange() {
    setPickedFrom(null)
    setPickedTo(null)
  }
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [editingOrderNumber, setEditingOrderNumber] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [warehouseLedgerOpen, setWarehouseLedgerOpen] = useState(false)
  const [picker, setPicker] = useState(false)

  const allSalesRaw = useLiveQuery(() => db.sales.orderBy('timestamp').reverse().toArray(), [])
  const allSales = useMemo(() => withoutVoided(allSalesRaw ?? []), [allSalesRaw])
  const rateRow = useLiveQuery(() => db.settings.get(EXCHANGE_RATE_KEY), [])
  const rate = rateRow ? Number(rateRow.value) : DEFAULT_EXCHANGE_RATE
  const [cardMenuFor, setCardMenuFor] = useState<number | null>(null)
  const salesDates = useMemo(() => new Set(allSales.map((s) => dateKeyMonrovia(s.timestamp))), [allSales])

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
      // The pair EXACTLY as typed/paid, added straight across every line in
      // the order -- this is the card's headline, always both fields, never
      // blended, never converted. paidPairOf reads paidUsd/paidLrd directly
      // (falls back to the old soldFor-derived model for sales recorded
      // before those fields existed).
      paidUsd: lines.reduce((s, l) => s + paidPairOf(l).usd, 0),
      paidLrd: lines.reduce((s, l) => s + paidPairOf(l).lrd, 0),
      // Balance owing is the only place the "agreed" reference amount's
      // value is used for display math -- shown in the currency the first
      // line's agreed price was set in, each line's own owing amount
      // converted into that one reference currency at the rate in effect
      // when it was recorded, before summing (never blended raw).
      owing: lines.reduce((s, l) => {
        const owed = owingOf(l)
        if (owed <= 0 || l.currency === lines[0].currency) return s + owed
        const lineRate = l.rateAtSale ?? rate
        return s + convertAmount(owed, l.currency, lines[0].currency, lineRate)
      }, 0),
      currency: lines[0].currency,
      rateAtSale: lines[0].rateAtSale,
    }))
    groups.sort((a, b) => b.timestamp - a.timestamp)
    return groups
  }, [allSales, rate])

  const owingOrders = useMemo(() => orders.filter((o) => o.owing > 0.005), [orders])
  const owingByCurrency = useMemo(() => {
    const m = {} as Record<Currency, number>
    for (const o of owingOrders) m[o.currency] = (m[o.currency] ?? 0) + o.owing
    return m
  }, [owingOrders])

  const filtered = useMemo(() => {
    let list = orders
    // Typing a search term looks across every order regardless of the
    // selected range -- a range picker that silently hid the thing you
    // just searched for would be worse than no range picker at all.
    if (q.trim()) {
      const t = q.toLowerCase()
      list = list.filter((o) => {
        if (customerLabelOf(o).toLowerCase().includes(t)) return true
        if (String(o.orderNumber).includes(t)) return true
        return o.lines.some((l) => l.itemName.toLowerCase().includes(t))
      })
    } else if (pickedRange) {
      const from = pickedRange.from <= pickedRange.to ? pickedRange.from : pickedRange.to
      const to = pickedRange.from <= pickedRange.to ? pickedRange.to : pickedRange.from
      list = list.filter((o) => {
        const key = dateKeyMonrovia(o.timestamp)
        return key >= from && key <= to
      })
    } else {
      const start = rangeStart(rangeTab)
      list = list.filter((o) => o.timestamp >= start)
    }
    if (filterTab === 'tbs') list = list.filter((o) => o.anyTbs)
    if (filterTab === 'owing') list = list.filter((o) => o.owing > 0.005)
    return list
  }, [orders, filterTab, q, rangeTab, pickedFrom, pickedTo])

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

  const [collectingOrderNumber, setCollectingOrderNumber] = useState<number | null>(null)
  const [collectAmount, setCollectAmount] = useState('')
  const collectingOrder = collectingOrderNumber != null ? orders.find((o) => o.orderNumber === collectingOrderNumber) ?? null : null

  function openCollect(order: OrderGroup) {
    setCollectingOrderNumber(order.orderNumber)
    setCollectAmount(order.currency === 'LRD' ? String(Math.round(order.owing)) : order.owing.toFixed(2))
  }
  async function submitCollect() {
    if (!collectingOrder) return
    const amt = Number(collectAmount) || 0
    if (amt > 0) await collectPayment(collectingOrder, Math.min(amt, collectingOrder.owing), rate)
    setCollectingOrderNumber(null)
    setCollectAmount('')
  }

  return (
    <div className="cl flex min-h-[calc(100dvh-6rem)] flex-col md:min-h-[calc(100dvh-2rem)]">
      <div className="hd">
        <div>
          <h1>Book</h1>
          <div className="sub">{filtered.length} of {orders.length} entries</div>
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
          {/* Which timeline is showing -- Book used to just dump every sale
              ever recorded into one long scroll. Searching bypasses this
              (see `filtered`) so an old order is still reachable by name.
              Today/This week/This month as quick shortcuts, plus a real
              calendar (From/To) for anything else -- marks days with no
              sales recorded so it doubles as "what do I still owe an
              entry for". */}
          <div className="chips" style={{ paddingTop: 4, opacity: q.trim() ? 0.4 : 1, pointerEvents: q.trim() ? 'none' : undefined }}>
            {RANGE_OPTIONS.map((opt) => (
              <button key={opt.value} className={!pickedRange && rangeTab === opt.value ? 'on' : ''} onClick={() => { setRangeTab(opt.value); clearPickedRange() }}>
                {opt.label}
              </button>
            ))}
            <button
              onClick={() => setFromCalendarOpen(true)}
              style={{
                background: pickedFrom ? 'var(--cl-ink)' : 'var(--cl-card)',
                color: pickedFrom ? 'var(--cl-bg)' : 'var(--cl-ink-2)',
                borderColor: pickedFrom ? 'var(--cl-ink)' : 'var(--cl-line)',
              }}
            >
              📅 From {pickedFrom ? formatShortDateMonrovia(new Date(`${pickedFrom}T12:00:00`).getTime()) : '…'}
            </button>
            <button
              onClick={() => pickedFrom && setToCalendarOpen(true)}
              disabled={!pickedFrom}
              style={{
                opacity: pickedFrom ? 1 : 0.4,
                background: pickedTo ? 'var(--cl-ink)' : 'var(--cl-card)',
                color: pickedTo ? 'var(--cl-bg)' : 'var(--cl-ink-2)',
                borderColor: pickedTo ? 'var(--cl-ink)' : 'var(--cl-line)',
              }}
            >
              To {pickedTo ? formatShortDateMonrovia(new Date(`${pickedTo}T12:00:00`).getTime()) : pickedFrom ? 'same day' : '…'}
            </button>
            {pickedFrom && <button onClick={clearPickedRange}>✕ Clear dates</button>}
          </div>

          <DateCalendarPicker
            open={fromCalendarOpen}
            onClose={() => setFromCalendarOpen(false)}
            value={pickedFrom}
            onSelect={setPickedFrom}
            salesDates={salesDates}
            title="From"
          />
          <DateCalendarPicker
            open={toCalendarOpen}
            onClose={() => setToCalendarOpen(false)}
            value={pickedTo}
            onSelect={setPickedTo}
            salesDates={salesDates}
            title="To"
          />

          <div className="chips" style={{ paddingTop: 4 }}>
            <button className={filterTab === 'all' ? 'on' : ''} onClick={() => setFilterTab('all')}>Everything</button>
            <button className={filterTab === 'tbs' ? 'on' : ''} onClick={() => setFilterTab('tbs')}>To be supplied</button>
            <button className={filterTab === 'owing' ? 'on' : ''} onClick={() => setFilterTab('owing')}>
              Owing{owingOrders.length > 0 ? ` · ${(Object.keys(owingByCurrency) as Currency[]).map((c) => money(owingByCurrency[c], c)).join(' + ')}` : ''}
            </button>
          </div>

          {!days.length && (
            <div className="empty">
              <b>Nothing here yet</b>
              <span>Record a sale in Sell, or tap "Fill a past day" to catch up on a day you missed.</span>
            </div>
          )}

          {days.map(([key, ss]) => {
            // The day's pair -- straight sum of every order's raw
            // paidUsd/paidLrd, both fields always shown, never blended.
            const dayUsd = ss.reduce((s, o) => s + o.paidUsd, 0)
            const dayLrd = ss.reduce((s, o) => s + o.paidLrd, 0)
            return (
            <div key={key}>
              <div className="day" style={{ alignItems: 'flex-start' }}>
                <span className="d">{dayLabel(key)}</span>
                <span style={{ textAlign: 'right' }}>
                  <span className="t m" style={{ display: 'block' }}>{money(dayUsd, 'USD')}</span>
                  <span className="t m" style={{ display: 'block' }}>+ {money(dayLrd, 'LRD')}</span>
                </span>
              </div>
              {ss.map((order) => {
                const label = customerLabelOf(order)
                const anyPendingPickup = order.lines.some((l) => l.tbs && !l.pickedUp)
                const anyPickedUp = order.lines.some((l) => l.tbs && l.pickedUp)
                // A balance payoff is its own kind of entry -- cash
                // collected against an old balance, not goods sold today
                // -- distinctly colored so it never reads as a fresh sale.
                const isPayoff = order.lines.some((l) => l.isPayoff)
                return (
                  <div
                    key={order.orderNumber}
                    className="entry"
                    style={{ cursor: 'pointer', background: isPayoff ? '#eef4ff' : undefined, borderColor: isPayoff ? '#bcd2ff' : undefined }}
                    onClick={() => setInvoiceOrderNumber(order.orderNumber)}
                  >
                    {/* Items on the left, total vertically centered on the
                        right. Names never truncate -- no line-clamp, no
                        ellipsis -- a long item list just wraps and grows
                        the card instead of clipping. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--cl-ink)', lineHeight: 1.45 }}>
                        {order.lines.map((l, i) => (
                          <span key={l.id}>
                            {i > 0 && ' · '}{l.qty} {l.unitType ? `${l.unitType} ` : ''}{l.itemName}
                            {l.tbs && !l.pickedUp && (
                              <button
                                onClick={(e) => { e.stopPropagation(); markSalePickedUp(l) }}
                                style={{ marginLeft: 5, border: 0, background: 'var(--cl-amber)', borderRadius: 6, padding: '1px 6px', font: '700 9px Archivo', cursor: 'pointer', color: 'var(--cl-ink)' }}
                              >
                                GIVE
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                      {/* The pair exactly as typed -- headline, green, never
                          blended -- BOTH fields always shown, even a zero
                          one, so it's unambiguous what was actually paid in
                          each currency. If there's a balance owing, that's
                          its own separate line below, not folded in here. */}
                      <span style={{ flexShrink: 0, textAlign: 'right' }}>
                        <span className="m" style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--cl-usd)' }}>
                          {money(order.paidUsd, 'USD')}
                        </span>
                        <span className="m" style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--cl-usd)' }}>
                          + {money(order.paidLrd, 'LRD')}
                        </span>
                      </span>
                    </div>

                    {order.owing > 0.005 && (
                      <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: 'var(--cl-alarm)' }}>
                        Balance owing: {money(order.owing, order.currency)}
                      </div>
                    )}

                    {(isPayoff || anyPendingPickup || anyPickedUp || order.owing > 0.005) && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                        {isPayoff && <span className="pill" style={{ background: '#3f5fce', color: 'white' }}>balance payment</span>}
                        {anyPendingPickup && <span className="pill amber">tbs</span>}
                        {anyPickedUp && !anyPendingPickup && <span className="pill grey">picked up</span>}
                        {order.owing > 0.005 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); openCollect(order) }}
                            className="pill red"
                            style={{ border: 0, cursor: 'pointer' }}
                          >
                            owing {money(order.owing, order.currency)} · collect
                          </button>
                        )}
                      </div>
                    )}

                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5, fontSize: 12, color: 'var(--cl-ink-2)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
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
                          <span>{label}</span>
                          <button onClick={() => startEdit(order)} aria-label="Rename customer" style={{ color: 'var(--cl-ink-3)' }}>
                            <EditIcon className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>

                    <div className="m" style={{ fontSize: 11, marginTop: 5, color: 'var(--cl-ink-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span>#{order.orderNumber} · {formatTimeMonrovia(order.timestamp)}</span>
                      <span style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setCardMenuFor(cardMenuFor === order.orderNumber ? null : order.orderNumber)}
                          aria-label="More options"
                          style={{ border: 0, background: 'none', color: 'var(--cl-ink-3)', cursor: 'pointer', padding: 2 }}
                        >
                          <MoreVerticalIcon className="h-3.5 w-3.5" />
                        </button>
                        {cardMenuFor === order.orderNumber && (
                          <div
                            style={{
                              position: 'absolute', right: 0, bottom: '100%', marginBottom: 4, zIndex: 20,
                              background: 'var(--cl-card)', border: '1px solid var(--cl-line)', borderRadius: 8,
                              boxShadow: '0 2px 10px rgba(0,0,0,.1)', whiteSpace: 'nowrap',
                            }}
                          >
                            <button
                              onClick={() => { setCardMenuFor(null); order.lines.forEach((l) => deleteSaleLine(l)) }}
                              style={{ border: 0, background: 'none', color: 'var(--cl-alarm)', font: '700 11px Archivo', cursor: 'pointer', padding: '8px 12px' }}
                            >
                              VOID
                            </button>
                          </div>
                        )}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
            )
          })}
        </div>
      </div>

      {collectingOrder && (
        <div className="sheet" onClick={() => setCollectingOrderNumber(null)}>
          <div className="sbox" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <div className="scroll" style={{ paddingBottom: 16 }}>
              <p className="eb">
                Collect payment · #{collectingOrder.orderNumber}
                <span className="n"> · owes {money(collectingOrder.owing, collectingOrder.currency)}</span>
              </p>
              <div className="fld">
                <input
                  autoFocus
                  className="in tabular"
                  inputMode="decimal"
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  placeholder={`Amount collected (${collectingOrder.currency})`}
                />
              </div>
              <button
                className="btn amber"
                style={{ width: '100%', marginTop: 10 }}
                disabled={(Number(collectAmount) || 0) <= 0}
                onClick={submitCollect}
              >
                Record payment
              </button>
            </div>
          </div>
        </div>
      )}

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
