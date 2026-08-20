import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, EXCHANGE_RATE_KEY, DEFAULT_EXCHANGE_RATE, type Currency, type Sale } from '../db'
import { EditIcon, SearchIcon, MoreVerticalIcon, BoxesIcon, ScanIcon } from '../components/icons'
import { LedgerScanView } from '../components/LedgerScan'
import { WarehouseLedgerView } from '../components/WarehouseLedger'
import { InvoicePopup } from '../components/InvoicePopup'
import { dateKeyMonrovia, formatShortDateMonrovia, formatTimeMonrovia, money } from '../lib/format'
import { collectPayment, customerLabelOf, deleteSaleLine, lrdAmountOf, markSalePickedUp, owingOf, usdAmountOf, withoutVoided } from '../lib/salesLedger'
import { convertAmount } from '../lib/sellUnits'
import { loadActiveDate, storeActiveDate } from '../lib/activeDate'

// Converts an amount to the other currency using the rate that was in
// effect when it was actually recorded (falls back to today's rate for
// sales predating that field) -- never re-prices an old sale at today's
// rate.
function secondaryAmountOf(amount: number, currency: Currency, rateAtSale: number | undefined, currentRate: number) {
  const rate = rateAtSale ?? currentRate
  return currency === 'USD' ? amount * rate : amount / rate
}
function otherCurrency(c: Currency): Currency {
  return c === 'USD' ? 'LRD' : 'USD'
}

type FilterTab = 'all' | 'tbs' | 'owing'
const DAY_MS = 24 * 60 * 60 * 1000

// How far back to look, so Book opens onto something scannable instead of
// every sale ever recorded. "Today" is the default -- switching ranges
// never discards anything, it's purely a view.
type RangeTab = 'today' | 'yesterday' | '7d' | '30d' | 'all'
const RANGE_OPTIONS: { value: RangeTab; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
]
function rangeStart(range: RangeTab): number {
  const todayStart = new Date(dateKeyMonrovia(Date.now()) + 'T00:00:00').getTime()
  switch (range) {
    case 'today': return todayStart
    case 'yesterday': return todayStart - DAY_MS
    case '7d': return todayStart - 6 * DAY_MS
    case '30d': return todayStart - 29 * DAY_MS
    case 'all': return 0
  }
}
function rangeEnd(range: RangeTab): number {
  const todayStart = new Date(dateKeyMonrovia(Date.now()) + 'T00:00:00').getTime()
  return range === 'yesterday' ? todayStart : Infinity
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
  total: number
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
      // A line can be split-paid across both currencies (usdAmountOf/
      // lrdAmountOf pull out each side correctly regardless of which one
      // was primary) -- naively adding soldFor + secondaryAmount together
      // used to blend two different currencies into one raw number
      // (e.g. "$50 + L$1000" read as "$1050"). Convert each side into the
      // order's own currency, at the rate that was actually in effect for
      // that line, before summing.
      total: lines.reduce((s, l) => {
        const lineRate = l.rateAtSale ?? rate
        const usdPart = usdAmountOf(l)
        const lrdPart = lrdAmountOf(l)
        return s + convertAmount(usdPart, 'USD', lines[0].currency, lineRate) + convertAmount(lrdPart, 'LRD', lines[0].currency, lineRate)
      }, 0),
      owing: lines.reduce((s, l) => s + owingOf(l), 0),
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
      const end = rangeEnd(rangeTab)
      list = list.filter((o) => o.timestamp >= start && o.timestamp < end)
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
    if (amt > 0) await collectPayment(collectingOrder.lines, Math.min(amt, collectingOrder.owing))
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
              (see `filtered`) so an old order is still reachable by name. */}
          <div className="chips" style={{ paddingTop: 4, opacity: q.trim() ? 0.4 : 1, pointerEvents: q.trim() ? 'none' : undefined }}>
            {RANGE_OPTIONS.map((opt) => (
              <button key={opt.value} className={!pickedRange && rangeTab === opt.value ? 'on' : ''} onClick={() => { setRangeTab(opt.value); clearPickedRange() }}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* An exact date range (e.g. June 4th through June 10th), not
              just the relative chips above -- two native <input
              type="date">s so it's the device's own calendar picker, not
              another custom sheet. A single day is just from === to. */}
          <div className="chips" style={{ paddingTop: 0, opacity: q.trim() ? 0.4 : 1, pointerEvents: q.trim() ? 'none' : undefined }}>
            <label
              style={{
                position: 'relative', display: 'inline-flex', alignItems: 'center', flex: '0 0 auto',
                padding: '8px 13px', border: '1px solid var(--cl-line)', borderRadius: 999, cursor: 'pointer',
                font: '700 11px Archivo, sans-serif', whiteSpace: 'nowrap',
                background: pickedFrom ? 'var(--cl-ink)' : 'var(--cl-card)',
                color: pickedFrom ? 'var(--cl-bg)' : 'var(--cl-ink-2)',
                borderColor: pickedFrom ? 'var(--cl-ink)' : 'var(--cl-line)',
              }}
            >
              📅 From {pickedFrom ? formatShortDateMonrovia(new Date(`${pickedFrom}T12:00:00`).getTime()) : '…'}
              <input
                type="date"
                value={pickedFrom ?? ''}
                onChange={(e) => setPickedFrom(e.target.value || null)}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
              />
            </label>
            <label
              style={{
                position: 'relative', display: 'inline-flex', alignItems: 'center', flex: '0 0 auto',
                padding: '8px 13px', border: '1px solid var(--cl-line)', borderRadius: 999, cursor: pickedFrom ? 'pointer' : 'default',
                font: '700 11px Archivo, sans-serif', whiteSpace: 'nowrap', opacity: pickedFrom ? 1 : 0.4,
                background: pickedTo ? 'var(--cl-ink)' : 'var(--cl-card)',
                color: pickedTo ? 'var(--cl-bg)' : 'var(--cl-ink-2)',
                borderColor: pickedTo ? 'var(--cl-ink)' : 'var(--cl-line)',
              }}
            >
              To {pickedTo ? formatShortDateMonrovia(new Date(`${pickedTo}T12:00:00`).getTime()) : pickedFrom ? 'same day' : '…'}
              <input
                type="date"
                disabled={!pickedFrom}
                value={pickedTo ?? ''}
                onChange={(e) => setPickedTo(e.target.value || null)}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: pickedFrom ? 'pointer' : 'default' }}
              />
            </label>
            {pickedFrom && (
              <button onClick={clearPickedRange} style={{ flex: '0 0 auto' }}>✕ Clear dates</button>
            )}
          </div>

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
            const dayByCurrency = ss.reduce((acc, o) => {
              acc[o.currency] = (acc[o.currency] ?? 0) + o.total
              return acc
            }, {} as Record<Currency, number>)
            const dayCurrencies = (Object.keys(dayByCurrency) as Currency[]).filter((c) => dayByCurrency[c] > 0)
            return (
            <div key={key}>
              <div className="day" style={{ alignItems: 'flex-start' }}>
                <span className="d">{dayLabel(key)}</span>
                <span style={{ textAlign: 'right' }}>
                  {dayCurrencies.length === 0 && <span className="t m">{money(0, 'USD')}</span>}
                  {dayCurrencies.map((c, i) => (
                    <span key={c} className="t m" style={{ display: 'block' }}>
                      {i > 0 ? '+ ' : ''}{money(dayByCurrency[c], c)}
                    </span>
                  ))}
                  {dayCurrencies.length === 1 && (
                    <span className="m" style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--cl-ink-3)' }}>
                      {money(secondaryAmountOf(dayByCurrency[dayCurrencies[0]], dayCurrencies[0], undefined, rate), otherCurrency(dayCurrencies[0]))}
                    </span>
                  )}
                </span>
              </div>
              {ss.map((order) => {
                const label = customerLabelOf(order)
                const anyPendingPickup = order.lines.some((l) => l.tbs && !l.pickedUp)
                const anyPickedUp = order.lines.some((l) => l.tbs && l.pickedUp)
                const secondary = secondaryAmountOf(order.total, order.currency, order.rateAtSale, rate)
                return (
                  <div
                    key={order.orderNumber}
                    className="entry"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setInvoiceOrderNumber(order.orderNumber)}
                  >
                    {/* Items on the left (truncated to 2 lines if the list
                        runs long -- a 6-item order shouldn't blow up the
                        card), total vertically centered on the right so
                        it's the first thing the eye lands on next to what
                        was actually sold. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--cl-ink)', lineHeight: 1.4,
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}
                      >
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
                      <span style={{ flexShrink: 0, textAlign: 'right' }}>
                        <span className="m" style={{ display: 'block', fontSize: 16, fontWeight: 700, color: 'var(--cl-usd)' }}>
                          {money(order.total, order.currency)}
                        </span>
                        <span className="m" style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--cl-ink-3)' }}>
                          {money(secondary, otherCurrency(order.currency))}
                        </span>
                      </span>
                    </div>

                    {(anyPendingPickup || anyPickedUp || order.owing > 0.005) && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
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
