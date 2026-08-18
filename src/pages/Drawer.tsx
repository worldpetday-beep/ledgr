import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, profitOf } from '../db'
import { ShopifyShell, shopifyInputClass, shopifyCardClass } from '../components/ShopifyShell'
import { Field } from '../components/ui'
import { money, dateKeyMonrovia, formatDateMonrovia, selectOnFocus } from '../lib/format'
import { lrdAmountOf, usdAmountOf, withoutVoided } from '../lib/salesLedger'

// The counter's own cash-drawer close-out: today's ledger sales vs what's
// actually in the drawer, opening balance carried from last night's count,
// money that went out, and the final hand-cash figure. Split out of Book
// into its own tab -- Book is "what did we sell", Drawer is "what's
// physically in the till right now".
export default function Drawer() {
  const todayKey = dateKeyMonrovia(Date.now())
  const allSalesRaw = useLiveQuery(() => db.sales.orderBy('timestamp').reverse().toArray(), [])
  const allSales = useMemo(() => withoutVoided(allSalesRaw ?? []), [allSalesRaw])
  const todaySales = useMemo(() => allSales.filter((s) => dateKeyMonrovia(s.timestamp) === todayKey), [allSales, todayKey])

  const ledgerSumUsd = useMemo(() => todaySales.reduce((s, l) => s + usdAmountOf(l), 0), [todaySales])
  const ledgerSumLrd = useMemo(() => todaySales.reduce((s, l) => s + lrdAmountOf(l), 0), [todaySales])

  // Net profit is an aggregate summary only — the underlying per-item cost
  // price itself is never shown on any individual daybook row.
  const netProfitUsd = useMemo(
    () => todaySales.filter((s) => s.currency === 'USD').reduce((s, l) => s + profitOf(l), 0),
    [todaySales],
  )
  const netProfitLrd = useMemo(
    () => todaySales.filter((s) => s.currency === 'LRD').reduce((s, l) => s + profitOf(l), 0),
    [todaySales],
  )

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

  return (
    <ShopifyShell title="Drawer">
      <div className="flex flex-col gap-4">
        <div className="px-1 text-xs font-semibold [color:var(--cl-ink-2)]">{formatDateMonrovia(Date.now())} — today</div>

        <div className={shopifyCardClass}>
          <h2 className="mb-3 text-sm font-semibold [color:var(--cl-ink)]">Sold vs cash in</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <div className="[color:var(--cl-ink-2)]">Ledger sales — USD</div>
            <div className="tabular text-right font-semibold [color:var(--cl-ink)]">{money(ledgerSumUsd, 'USD')}</div>
            <div className="[color:var(--cl-ink-2)]">Ledger sales — LRD</div>
            <div className="tabular text-right font-semibold [color:var(--cl-ink)]">{money(ledgerSumLrd, 'LRD')}</div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t [border-color:var(--cl-line)] pt-2 text-sm">
            <div className="[color:var(--cl-ink-2)]">Net profit — USD</div>
            <div className="tabular text-right font-semibold" style={{ color: 'var(--cl-usd)' }}>{money(netProfitUsd, 'USD')}</div>
            <div className="[color:var(--cl-ink-2)]">Net profit — LRD</div>
            <div className="tabular text-right font-semibold" style={{ color: 'var(--cl-usd)' }}>{money(netProfitLrd, 'LRD')}</div>
          </div>
          <p className="mt-2 text-xs [color:var(--cl-ink-3)]">
            Sold and cash-in won't always match — a balance still owed on a sale is ledger revenue that hasn't hit the drawer yet.
          </p>
        </div>

        <div className={shopifyCardClass}>
          <h2 className="mb-3 text-sm font-semibold [color:var(--cl-ink)]">Count the drawer</h2>
          <div className="grid grid-cols-2 gap-3">
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
            <Field label="Money out — USD">
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
            <Field label="Money out — LRD">
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

          <div className="mt-3 border-t [border-color:var(--cl-line)] pt-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <div className="[color:var(--cl-ink-2)]">Final hand cash — USD</div>
              <div className="tabular text-right text-base font-bold [color:var(--cl-ink)]">{money(finalHandCashUsd, 'USD')}</div>
              <div className="[color:var(--cl-ink-2)]">Final hand cash — LRD</div>
              <div className="tabular text-right text-base font-bold [color:var(--cl-ink)]">{money(finalHandCashLrd, 'LRD')}</div>
            </div>
            {yesterdayClose && (
              <p className="mt-2 text-xs [color:var(--cl-ink-3)]">
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
          <button onClick={logDayEndCount} className="mt-3 w-full rounded-xl py-2.5 text-sm font-bold uppercase tracking-wide" style={{ background: 'var(--cl-amber)', color: 'var(--cl-ink)' }}>
            Close the day
          </button>
        </div>
      </div>
    </ShopifyShell>
  )
}
