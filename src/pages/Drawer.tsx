import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DRAWER_OUT_KINDS, EXCHANGE_RATE_KEY, DEFAULT_EXCHANGE_RATE, type DrawerOut, type Currency } from '../db'
import { money, dateKeyMonrovia, formatShortDateMonrovia } from '../lib/format'
import { owingUsd, paidPairOf, saleValueUsd, withoutVoided } from '../lib/salesLedger'
import { loadActiveDate, storeActiveDate } from '../lib/activeDate'
import { DateCalendarPicker } from '../components/DateCalendarPicker'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// Any file type is accepted (not just images), so this can't always lean on
// ItemThumb's image-only rendering -- shows a real preview for images, a
// plain file-type badge for anything else (e.g. a scanned PDF).
function AttachmentThumb({ file }: { file: Blob & { name?: string } }) {
  const [url, setUrl] = useState<string | null>(null)
  const isImage = file.type?.startsWith('image/')

  useEffect(() => {
    if (!isImage) return
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file, isImage])

  if (isImage && url) {
    return <img src={url} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', border: '1px solid var(--cl-line)' }} />
  }
  return (
    <div style={{ width: 64, height: 64, borderRadius: 12, border: '1px solid var(--cl-line)', background: 'var(--cl-line-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: 'var(--cl-ink-3)', textAlign: 'center', padding: 4 }}>
    file
    </div>
  )
}

function outsByCurrency(outs: DrawerOut[], cur: Currency): number {
  return outs.filter((o) => o.cur === cur).reduce((s, o) => s + o.amt, 0)
}

// A withdrawal/paid-out row shared by both the till's "money that went
// out" list and the safe's "taken out" list -- only the currency total
// each contributes to differs by which array it's saved into.
function OutRow({ out, onUpdate, onRemove }: { out: DrawerOut; onUpdate: (patch: Partial<DrawerOut>) => void; onRemove: () => void }) {
  return (
    <div className="card" style={{ padding: '11px 12px' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          className="in"
          style={{ flex: 1, padding: '9px 11px', fontSize: 14 }}
          placeholder="Who / what for"
          value={out.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
        />
        <button className="rm" style={{ fontSize: 16 }} onClick={onRemove} aria-label="Remove">✕</button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <select className="in" style={{ flex: 1.2, padding: '9px 10px', fontSize: 13 }} value={out.kind} onChange={(e) => onUpdate({ kind: e.target.value })}>
          {DRAWER_OUT_KINDS.map((k) => <option key={k}>{k}</option>)}
        </select>
        <select className="in" style={{ width: 80, padding: '9px 8px', fontSize: 13 }} value={out.cur} onChange={(e) => onUpdate({ cur: e.target.value as Currency })}>
          <option>USD</option>
          <option>LRD</option>
        </select>
        <input
          className="in m"
          style={{ width: 90, padding: '9px 10px', fontSize: 15 }}
          inputMode="decimal"
          placeholder="0"
          value={out.amt || ''}
          onChange={(e) => onUpdate({ amt: Number(e.target.value) || 0 })}
        />
      </div>
    </div>
  )
}

type QuickRange = 'today' | 'week' | 'month'

// Two drawers, matching how the shop actually runs:
//
// Drawer 1, the till -- starts EMPTY every morning (no opening float, that
// concept doesn't apply here). Every dollar collected today goes in;
// what's paid out of it same-day is itemized below; counting it at close
// and tapping "Sweep to safe" moves the counted total into Drawer 2 and
// resets the till to zero for tomorrow -- sweeps what was actually
// counted, not what was expected, so a shortfall stays visible on that
// day's own record instead of quietly vanishing into the safe's number.
//
// Drawer 2, the safe -- carries a running balance across days. Its
// opening balance for any given day is computed by walking every prior
// day's sweep-in/withdrawal activity (or an explicit override on some
// earlier day, which resets the running base from there forward) --
// nothing needs to be cached or kept in sync by hand. Money can be taken
// out of it at any point, for any purpose, logged on whatever day it
// actually happened.
export default function Drawer() {
  const [d, setDState] = useState(() => loadActiveDate() ?? dateKeyMonrovia(Date.now()))
  function setD(key: string) {
    setDState(key)
    storeActiveDate(key)
  }
  const [calendarOpen, setCalendarOpen] = useState(false)
  const todayKey = dateKeyMonrovia(Date.now())

  const records = useLiveQuery(() => db.drawerCounts.orderBy('timestamp').toArray(), []) ?? []
  const rec = useMemo(() => records.find((r) => dateKeyMonrovia(r.timestamp) === d) ?? null, [records, d])

  const salesRaw = useLiveQuery(() => db.sales.orderBy('timestamp').toArray(), []) ?? []
  const allSales = useMemo(() => withoutVoided(salesRaw), [salesRaw])
  const daySales = useMemo(() => allSales.filter((s) => dateKeyMonrovia(s.timestamp) === d), [allSales, d])
  const salesDates = useMemo(() => new Set(allSales.map((s) => dateKeyMonrovia(s.timestamp))), [allSales])
  const rateRow = useLiveQuery(() => db.settings.get(EXCHANGE_RATE_KEY), [])
  const rate = rateRow ? Number(rateRow.value) : DEFAULT_EXCHANGE_RATE

  // "Goods sold" vs "cash collected" are deliberately different numbers --
  // cash collected can be HIGHER than goods sold whenever an old balance
  // gets paid off today (real money in, but no new goods went out), and
  // LOWER whenever today's sales are left with a balance owing. A payoff
  // line (collectPayment's own dated entry) is exactly that "old balance"
  // case -- real cash in, but the goods themselves were already counted
  // sold the day they actually left, so it's excluded from goods sold.
  const goodsSold = daySales.filter((l) => !l.isPayoff).reduce((s, l) => s + saleValueUsd(l, rate), 0)
  // Exactly what was typed into the Settle sheet's payment fields (same
  // paidPairOf Book reads) -- not a derived/rounded figure.
  const inU = daySales.reduce((s, l) => s + paidPairOf(l).usd, 0)
  const inL = daySales.reduce((s, l) => s + paidPairOf(l).lrd, 0)
  const stillOwed = daySales.reduce((s, l) => s + owingUsd(l, rate), 0)

  // Drawer 1 -- the till. No opening float: it starts at zero every day,
  // full stop.
  const tillOuts = rec?.outs ?? []
  const tillOutU = outsByCurrency(tillOuts, 'USD')
  const tillOutL = outsByCurrency(tillOuts, 'LRD')
  const tillShouldU = inU - tillOutU
  const tillShouldL = inL - tillOutL
  const tillGotU = rec ? rec.usdActual : null
  const tillGotL = rec ? rec.lrdActual : null
  const tillDiffU = tillGotU === null ? null : tillGotU - tillShouldU
  const tillDiffL = tillGotL === null ? null : (tillGotL ?? 0) - tillShouldL

  // Drawer 2 -- the safe. Walk every day strictly before `d`, applying any
  // override (resets the running base) then that day's sweep-in and
  // withdrawals, to get the balance the safe opened with on day `d`.
  const safeOpenOf = useMemo(() => {
    const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp)
    let usd = 0
    let lrd = 0
    for (const r of sorted) {
      if (dateKeyMonrovia(r.timestamp) >= d) break
      if (r.safeOpenUsdOverride != null) usd = r.safeOpenUsdOverride
      if (r.safeOpenLrdOverride != null) lrd = r.safeOpenLrdOverride
      usd += r.sweptUsd ?? 0
      lrd += r.sweptLrd ?? 0
      usd -= outsByCurrency(r.safeOuts ?? [], 'USD')
      lrd -= outsByCurrency(r.safeOuts ?? [], 'LRD')
    }
    return { usd, lrd }
  }, [records, d])
  const safeOpenU = rec?.safeOpenUsdOverride ?? safeOpenOf.usd
  const safeOpenL = rec?.safeOpenLrdOverride ?? safeOpenOf.lrd
  const sweptU = rec?.sweptUsd ?? 0
  const sweptL = rec?.sweptLrd ?? 0
  const safeOuts = rec?.safeOuts ?? []
  const safeOutU = outsByCurrency(safeOuts, 'USD')
  const safeOutL = outsByCurrency(safeOuts, 'LRD')
  const safeNowU = safeOpenU + sweptU - safeOutU
  const safeNowL = safeOpenL + sweptL - safeOutL

  async function upsert(patch: Partial<Omit<import('../db').DrawerCount, 'id'>>) {
    if (rec?.id) {
      await db.drawerCounts.update(rec.id, patch)
    } else {
      await db.drawerCounts.add({
        timestamp: new Date(`${d}T12:00:00`).getTime(),
        usdActual: 0,
        lrdActual: 0,
        outs: [],
        ...patch,
      })
    }
  }

  function addTillOut() {
    upsert({ outs: [...tillOuts, { id: uid(), name: '', amt: 0, cur: 'USD', kind: DRAWER_OUT_KINDS[0] }] })
  }
  function updateTillOut(id: string, patch: Partial<DrawerOut>) {
    upsert({ outs: tillOuts.map((o) => (o.id === id ? { ...o, ...patch } : o)) })
  }
  function removeTillOut(id: string) {
    upsert({ outs: tillOuts.filter((o) => o.id !== id) })
  }

  function addSafeOut() {
    upsert({ safeOuts: [...safeOuts, { id: uid(), name: '', amt: 0, cur: 'USD', kind: DRAWER_OUT_KINDS[0] }] })
  }
  function updateSafeOut(id: string, patch: Partial<DrawerOut>) {
    upsert({ safeOuts: safeOuts.map((o) => (o.id === id ? { ...o, ...patch } : o)) })
  }
  function removeSafeOut(id: string) {
    upsert({ safeOuts: safeOuts.filter((o) => o.id !== id) })
  }

  // Sweeps what was actually COUNTED (not the expected/"should be"
  // figure) into the safe, and closes the day -- tomorrow's till starts
  // at zero regardless of what happened today.
  async function sweepToSafe() {
    await upsert({ sweptUsd: tillGotU ?? 0, sweptLrd: tillGotL ?? 0, closed: true })
  }
  async function reopenDay() {
    await upsert({ sweptUsd: 0, sweptLrd: 0, closed: false })
  }

  function goQuickRange(range: QuickRange) {
    const today = new Date()
    if (range === 'today') { setD(todayKey); return }
    if (range === 'week') {
      const day = today.getDay()
      const monday = new Date(today)
      monday.setDate(today.getDate() - ((day + 6) % 7))
      setD(dateKeyMonrovia(monday.getTime()))
      return
    }
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    setD(dateKeyMonrovia(firstOfMonth.getTime()))
  }

  return (
    <div className="cl flex min-h-[calc(100dvh-6rem)] flex-col md:min-h-[calc(100dvh-2rem)]">
      <div className="hd">
        <div>
          <h1>Drawer</h1>
          <div className="sub">{d === todayKey ? 'Today' : formatShortDateMonrovia(new Date(`${d}T12:00:00`).getTime())}</div>
        </div>
        <button className="btn-s" onClick={() => setCalendarOpen(true)}>📅 {d}</button>
      </div>

      <div className="body">
        <div className="pad">
          {/* Today/This week/This month jump to that period's first day --
              Drawer is inherently a one-day-at-a-time view, so "this week"
              means "go to Monday", not a multi-day range like Book/Numbers
              use these same three shortcuts for. */}
          <div className="chips" style={{ paddingTop: 0, marginBottom: 4 }}>
            <button className={d === todayKey ? 'on' : ''} onClick={() => goQuickRange('today')}>Today</button>
            <button onClick={() => goQuickRange('week')}>This week</button>
            <button onClick={() => goQuickRange('month')}>This month</button>
          </div>

          <div className="g2" style={{ marginTop: 4 }}>
            <div className="kpi">
              <span className="k">Goods sold today</span>
              <span className="v m">{money(goodsSold, 'USD')}</span>
              <span className="s">{daySales.filter((l) => !l.isPayoff).length} sale{daySales.filter((l) => !l.isPayoff).length === 1 ? '' : 's'} — value of everything sold, paid or not</span>
            </div>
            <div className="kpi a">
              <span className="k">Cash collected today</span>
              <span className="v m">{money(inU + inL / rate, 'USD')}</span>
              <span className="s m">{money(inU, 'USD')} + {money(inL, 'LRD')} — physically came in, incl. old balances paid off</span>
            </div>
          </div>

          {stillOwed > 0.005 && (
            <div className="warn" style={{ marginBottom: 12 }}>
              <span>⚠</span>
              <span>{money(stillOwed, 'USD')} of today's sales is still owed — that's the gap between goods sold and cash collected.</span>
            </div>
          )}

          <p className="eb">Drawer 1 — the till<span className="n"> — starts empty every morning</span></p>
          <div className="card">
            <div className="st"><span className="k">Cash collected today</span><span className="v m">{money(inU, 'USD')} + {money(inL, 'LRD')}</span></div>
            <div className="st"><span className="k">− Paid out from the till</span><span className="v m" style={{ color: 'var(--cl-alarm)' }}>{money(tillOutU, 'USD')} + {money(tillOutL, 'LRD')}</span></div>
            <div className="st"><span className="k">= Should be in the till</span><span className="v m">{money(tillShouldU, 'USD')} + {money(tillShouldL, 'LRD')}</span></div>
          </div>

          <p className="eb">Money paid out of the till today</p>
          {tillOuts.map((o) => (
            <OutRow key={o.id} out={o} onUpdate={(patch) => updateTillOut(o.id, patch)} onRemove={() => removeTillOut(o.id)} />
          ))}
          <button className="btn ghost" onClick={addTillOut}>+ Add money out</button>

          <p className="eb" style={{ marginTop: 14 }}>Count the till</p>
          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              <div>
                <label className="lab">USD counted</label>
                <input className="in m" inputMode="decimal" placeholder="0.00" value={rec?.usdActual || ''} onChange={(e) => upsert({ usdActual: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="lab">LRD counted</label>
                <input className="in m" inputMode="decimal" placeholder="0" value={rec?.lrdActual || ''} onChange={(e) => upsert({ lrdActual: Number(e.target.value) || 0 })} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="st"><span className="k">Difference (USD)</span><span className="v m" style={{ color: tillDiffU === null ? 'var(--cl-ink-3)' : Math.abs(tillDiffU) < 0.01 ? 'var(--cl-usd)' : 'var(--cl-alarm)' }}>{tillDiffU === null ? 'count first' : `${tillDiffU > 0 ? '+' : ''}${money(tillDiffU, 'USD')}`}</span></div>
              <div className="st"><span className="k">Difference (LRD)</span><span className="v m" style={{ color: tillDiffL === null ? 'var(--cl-ink-3)' : Math.abs(tillDiffL) < 1 ? 'var(--cl-usd)' : 'var(--cl-alarm)' }}>{tillDiffL === null ? 'count first' : `${tillDiffL > 0 ? '+' : ''}${money(tillDiffL, 'LRD')}`}</span></div>
            </div>
          </div>

          <button className={`btn ${rec?.closed ? 'ghost' : 'amber'}`} onClick={rec?.closed ? reopenDay : sweepToSafe} disabled={tillGotU === null}>
            {rec?.closed ? 'Reopen this day' : 'Sweep counted total to the safe'}
          </button>
          <p style={{ fontSize: 11, color: 'var(--cl-ink-3)', marginTop: 9, lineHeight: 1.55 }}>
            {rec?.closed
              ? `Swept ${money(sweptU, 'USD')} + ${money(sweptL, 'LRD')} to the safe. Reopening clears the sweep and lets you recount.`
              : 'Sweeps what was actually counted above (not "should be there") -- a shortfall stays visible on this day\'s record either way.'}
          </p>

          <p className="eb" style={{ marginTop: 18 }}>Drawer 2 — the safe<span className="n"> — carries over day to day</span></p>
          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginBottom: 10 }}>
              <div>
                <label className="lab">Opening USD</label>
                <input className="in m" inputMode="decimal" value={rec?.safeOpenUsdOverride ?? ''} placeholder={String(safeOpenOf.usd)} onChange={(e) => upsert({ safeOpenUsdOverride: e.target.value === '' ? undefined : Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="lab">Opening LRD</label>
                <input className="in m" inputMode="decimal" value={rec?.safeOpenLrdOverride ?? ''} placeholder={String(safeOpenOf.lrd)} onChange={(e) => upsert({ safeOpenLrdOverride: e.target.value === '' ? undefined : Number(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="st"><span className="k">Balance in the safe</span><span className="v m">{money(safeOpenU, 'USD')} + {money(safeOpenL, 'LRD')}</span></div>
            <div className="st"><span className="k">+ Swept in today</span><span className="v m" style={{ color: 'var(--cl-usd)' }}>{money(sweptU, 'USD')} + {money(sweptL, 'LRD')}</span></div>
            <div className="st"><span className="k">− Taken out</span><span className="v m" style={{ color: 'var(--cl-alarm)' }}>{money(safeOutU, 'USD')} + {money(safeOutL, 'LRD')}</span></div>
            <div className="st"><span className="k">= Balance now</span><span className="v m">{money(safeNowU, 'USD')} + {money(safeNowL, 'LRD')}</span></div>
          </div>

          <p className="eb">Taken out of the safe today</p>
          {safeOuts.map((o) => (
            <OutRow key={o.id} out={o} onUpdate={(patch) => updateSafeOut(o.id, patch)} onRemove={() => removeSafeOut(o.id)} />
          ))}
          <button className="btn ghost" onClick={addSafeOut}>+ Add money taken out</button>
          <p style={{ fontSize: 11, color: 'var(--cl-ink-3)', marginTop: 9, lineHeight: 1.5 }}>
            Only withdrawals marked "Expense" count against profit on Numbers — Sent to brother, Taken home and Lend are movements of your own money, not costs.
          </p>

          <p className="eb" style={{ marginTop: 18 }}>Attach a photo<span className="n"> — when there's only time for the total, not every line</span></p>
          <div className="card">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(rec?.attachments ?? []).map((file, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <AttachmentThumb file={file} />
                  <button
                    onClick={() => upsert({ attachments: (rec?.attachments ?? []).filter((_, j) => j !== i) })}
                    aria-label="Remove attachment"
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'var(--cl-ink)', color: 'var(--cl-bg)', fontSize: 11, lineHeight: '20px' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <label style={{ width: 64, height: 64, borderRadius: 12, border: '2px dashed var(--cl-line)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--cl-ink-3)', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>
                +<span>Add</span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    if (files.length) upsert({ attachments: [...(rec?.attachments ?? []), ...files] })
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            <p style={{ fontSize: 11, color: 'var(--cl-ink-3)', margin: '9px 0 0', lineHeight: 1.5 }}>
              Photos or PDFs, any number -- kept as backup for this day, separate from the numbers above.
            </p>
          </div>
        </div>
      </div>

      <DateCalendarPicker open={calendarOpen} onClose={() => setCalendarOpen(false)} value={d} onSelect={setD} salesDates={salesDates} title="Which day?" />
    </div>
  )
}
