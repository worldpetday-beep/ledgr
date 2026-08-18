import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DRAWER_OUT_KINDS, EXCHANGE_RATE_KEY, DEFAULT_EXCHANGE_RATE, type DrawerOut, type Currency } from '../db'
import { money, dateKeyMonrovia, formatShortDateMonrovia } from '../lib/format'
import { lrdAmountOf, usdAmountOf, withoutVoided } from '../lib/salesLedger'

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

// One record per calendar day, edited in place (every field autosaves) --
// exactly the reference's `cash[date]` model. Sold vs cash-in up top (with
// a note explaining the gap when balances are owed), opening balance
// carried from the previous day's count but overridable, itemized money
// out with a per-kind subtotal, counted vs expected vs difference, and a
// close/reopen toggle.
export default function Drawer() {
  const [d, setD] = useState(() => dateKeyMonrovia(Date.now()))
  const [pickerOpen, setPickerOpen] = useState(false)
  const todayKey = dateKeyMonrovia(Date.now())

  const records = useLiveQuery(() => db.drawerCounts.orderBy('timestamp').toArray(), []) ?? []
  const rec = useMemo(() => records.find((r) => dateKeyMonrovia(r.timestamp) === d) ?? null, [records, d])
  const prevRec = useMemo(
    () => records.filter((r) => dateKeyMonrovia(r.timestamp) < d).sort((a, b) => b.timestamp - a.timestamp)[0] ?? null,
    [records, d],
  )

  const salesRaw = useLiveQuery(() => db.sales.orderBy('timestamp').toArray(), []) ?? []
  const daySales = useMemo(
    () => withoutVoided(salesRaw).filter((s) => dateKeyMonrovia(s.timestamp) === d),
    [salesRaw, d],
  )
  const rateRow = useLiveQuery(() => db.settings.get(EXCHANGE_RATE_KEY), [])
  const rate = rateRow ? Number(rateRow.value) : DEFAULT_EXCHANGE_RATE

  const sold = daySales.reduce((s, l) => s + l.soldFor + (l.secondaryAmount ?? 0), 0)
  const inU = daySales.reduce((s, l) => s + usdAmountOf(l), 0)
  const inL = daySales.reduce((s, l) => s + lrdAmountOf(l), 0)
  const soldButNotCash = sold - (inU + inL / rate)

  const outs = rec?.outs ?? []
  const outU = outs.filter((o) => o.cur === 'USD').reduce((s, o) => s + o.amt, 0)
  const outL = outs.filter((o) => o.cur === 'LRD').reduce((s, o) => s + o.amt, 0)

  const openU = rec?.openUsdOverride ?? prevRec?.usdActual ?? 0
  const openL = rec?.openLrdOverride ?? prevRec?.lrdActual ?? 0
  const expU = openU + inU - outU
  const expL = openL + inL - outL
  const gotU = rec ? rec.usdActual : null
  const gotL = rec ? rec.lrdActual : null
  const diff = gotU === null ? null : (gotU - expU) + ((gotL ?? 0) - expL) / rate

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

  function addOut() {
    upsert({ outs: [...outs, { id: uid(), name: '', amt: 0, cur: 'USD', kind: DRAWER_OUT_KINDS[0] }] })
  }
  function updateOut(id: string, patch: Partial<DrawerOut>) {
    upsert({ outs: outs.map((o) => (o.id === id ? { ...o, ...patch } : o)) })
  }
  function removeOut(id: string) {
    upsert({ outs: outs.filter((o) => o.id !== id) })
  }

  return (
    <div className="cl flex min-h-[calc(100dvh-6rem)] flex-col md:min-h-[calc(100dvh-2rem)]">
      <div className="hd">
        <div>
          <h1>Drawer</h1>
          <div className="sub">{d === todayKey ? 'Today' : formatShortDateMonrovia(new Date(`${d}T12:00:00`).getTime())}</div>
        </div>
        <button className="btn-s" onClick={() => setPickerOpen(true)}>{d}</button>
      </div>

      <div className="body">
        <div className="pad">
          <div className="g2" style={{ marginTop: 4 }}>
            <div className="kpi">
              <span className="k">Sold today</span>
              <span className="v m">{money(sold, 'USD')}</span>
              <span className="s">{daySales.length} sale{daySales.length === 1 ? '' : 's'}</span>
            </div>
            <div className="kpi a">
              <span className="k">Cash came in</span>
              <span className="v m">{money(inU + inL / rate, 'USD')}</span>
              <span className="s m">{money(inU, 'USD')} + {money(inL, 'LRD')}</span>
            </div>
          </div>

          {soldButNotCash > 0.005 && (
            <div className="warn" style={{ marginBottom: 12 }}>
              <span>⚠</span>
              <span>{money(soldButNotCash, 'USD')} of today's sales is still owed — that's the gap between sold and cash.</span>
            </div>
          )}

          <p className="eb">Carried from yesterday</p>
          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              <div>
                <label className="lab">USD</label>
                <input
                  className="in m"
                  inputMode="decimal"
                  value={rec?.openUsdOverride ?? ''}
                  placeholder={String(openU)}
                  onChange={(e) => upsert({ openUsdOverride: e.target.value === '' ? undefined : Number(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="lab">LRD</label>
                <input
                  className="in m"
                  inputMode="decimal"
                  value={rec?.openLrdOverride ?? ''}
                  placeholder={String(openL)}
                  onChange={(e) => upsert({ openLrdOverride: e.target.value === '' ? undefined : Number(e.target.value) || 0 })}
                />
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--cl-ink-3)', margin: '9px 0 0', lineHeight: 1.5 }}>
              {prevRec ? "Filled in from last night's count. Type over it if the drawer started different." : 'Type what was in the drawer this morning.'}
            </p>
          </div>

          <p className="eb">Money that went out</p>
          {outs.map((o) => (
            <div className="card" key={o.id} style={{ padding: '11px 12px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input
                  className="in"
                  style={{ flex: 1, padding: '9px 11px', fontSize: 14 }}
                  placeholder="Who / what for"
                  value={o.name}
                  onChange={(e) => updateOut(o.id, { name: e.target.value })}
                />
                <button className="rm" style={{ fontSize: 16 }} onClick={() => removeOut(o.id)} aria-label="Remove">✕</button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  className="in"
                  style={{ flex: 1.2, padding: '9px 10px', fontSize: 13 }}
                  value={o.kind}
                  onChange={(e) => updateOut(o.id, { kind: e.target.value })}
                >
                  {DRAWER_OUT_KINDS.map((k) => <option key={k}>{k}</option>)}
                </select>
                <select
                  className="in"
                  style={{ width: 80, padding: '9px 8px', fontSize: 13 }}
                  value={o.cur}
                  onChange={(e) => updateOut(o.id, { cur: e.target.value as Currency })}
                >
                  <option>USD</option>
                  <option>LRD</option>
                </select>
                <input
                  className="in m"
                  style={{ width: 90, padding: '9px 10px', fontSize: 15 }}
                  inputMode="decimal"
                  placeholder="0"
                  value={o.amt || ''}
                  onChange={(e) => updateOut(o.id, { amt: Number(e.target.value) || 0 })}
                />
              </div>
            </div>
          ))}
          <button className="btn ghost" onClick={addOut}>+ Add money out</button>

          {(outU > 0 || outL > 0) && (
            <div className="card" style={{ marginTop: 10 }}>
              <div className="st">
                <span className="k">Total out</span>
                <span className="v m" style={{ color: 'var(--cl-alarm)' }}>−{money(outU + outL / rate, 'USD')}</span>
              </div>
              {DRAWER_OUT_KINDS.filter((k) => outs.some((o) => o.kind === k)).map((k) => (
                <div className="st" key={k}>
                  <span className="k">{k}</span>
                  <span className="v m">
                    {money(outs.filter((o) => o.kind === k).reduce((s, o) => s + o.amt / (o.cur === 'LRD' ? rate : 1), 0), 'USD')}
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="eb">Count the drawer</p>
          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              <div>
                <label className="lab">USD counted</label>
                <input
                  className="in m"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={rec?.usdActual || ''}
                  onChange={(e) => upsert({ usdActual: Number(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="lab">LRD counted</label>
                <input
                  className="in m"
                  inputMode="decimal"
                  placeholder="0"
                  value={rec?.lrdActual || ''}
                  onChange={(e) => upsert({ lrdActual: Number(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="st">
                <span className="k">Should be there</span>
                <span className="v m">{money(expU, 'USD')} + {money(expL, 'LRD')}</span>
              </div>
              <div className="st">
                <span className="k">Actually there</span>
                <span className="v m">{gotU === null ? '—' : `${money(gotU, 'USD')} + ${money(gotL ?? 0, 'LRD')}`}</span>
              </div>
              <div className="st">
                <span className="k">Difference</span>
                <span className="v m" style={{ color: diff === null ? 'var(--cl-ink-3)' : Math.abs(diff) < 0.01 ? 'var(--cl-usd)' : 'var(--cl-alarm)' }}>
                  {diff === null ? 'count first' : `${diff > 0 ? '+' : ''}${money(diff, 'USD')}`}
                </span>
              </div>
            </div>
          </div>

          <p className="eb">Attach a photo<span className="n"> — when there's only time for the total, not every line</span></p>
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

          <button
            className={`btn ${rec?.closed ? 'ghost' : 'amber'}`}
            onClick={() => upsert({ closed: !rec?.closed })}
          >
            {rec?.closed ? 'Reopen this day' : 'Close the day'}
          </button>
          <p style={{ fontSize: 11, color: 'var(--cl-ink-3)', marginTop: 9, lineHeight: 1.55 }}>
            Tonight's count becomes tomorrow's opening drawer.
          </p>
        </div>
      </div>

      {pickerOpen && (
        <div className="sheet" onClick={() => setPickerOpen(false)}>
          <div className="sbox" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <div className="scroll" style={{ paddingBottom: 16 }}>
              <p className="eb">Which day?</p>
              {Array.from({ length: 14 }, (_, i) => dateKeyMonrovia(Date.now() - i * 86400000)).map((key) => (
                <button
                  key={key}
                  className="btn ghost"
                  style={{
                    marginBottom: 8,
                    textAlign: 'left',
                    letterSpacing: 0,
                    textTransform: 'none',
                    fontSize: 14,
                    borderColor: key === d ? 'var(--cl-amber)' : 'var(--cl-line)',
                    background: key === d ? '#fffbf0' : 'transparent',
                  }}
                  onClick={() => { setD(key); setPickerOpen(false) }}
                >
                  {key === todayKey ? 'Today' : formatShortDateMonrovia(new Date(`${key}T12:00:00`).getTime())}
                  <span className="m" style={{ color: 'var(--cl-ink-3)', fontWeight: 500, marginLeft: 8 }}>{key}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
