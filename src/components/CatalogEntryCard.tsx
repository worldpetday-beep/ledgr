import { useState } from 'react'
import type { Currency } from '../db'
import { money } from '../lib/format'

// The cost figure itself, editable in place wherever it's shown (Sell's
// search results, Stock's SKU cards) instead of only being fixable via a
// separate product-editor screen -- tapping it swaps straight to a number
// input, Enter/blur commits. Lives in its own row so it never fights the
// card's own onClick (title/price) for the tap.
function EditableCost({ cost, onCommit }: { cost: number; onCommit: (next: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(String(cost))

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setText(cost ? String(cost) : '')
          setEditing(true)
        }}
        className="m"
        style={{ fontSize: 11, color: 'var(--cl-ink-3)', textDecoration: 'underline dotted', textUnderlineOffset: 2 }}
      >
        cost {money(cost, 'USD')}
      </button>
    )
  }

  function commit() {
    setEditing(false)
    const next = Number(text)
    if (!Number.isNaN(next) && next !== cost) onCommit(Math.max(0, next))
  }

  return (
    <input
      autoFocus
      type="number"
      inputMode="decimal"
      step="0.01"
      value={text}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="m tabular"
      style={{
        width: 64, fontSize: 11, color: 'var(--cl-ink)', border: '1px solid var(--cl-amber)',
        borderRadius: 5, padding: '1px 4px', background: 'var(--cl-card)',
      }}
    />
  )
}

// One product/variant as its own standalone card -- title + price on the
// top line, "cost $X.XX -> +$Y.YY per <unit>" (the markup) on the left of
// the second line, stock on the right. Used by both Sell (search results)
// and Stock (the catalog list) so a SKU reads identically everywhere.
// In Sell the top-right price stays plain ink (not the --cl-usd green used
// for actual money-in-hand figures elsewhere) since it's a catalog price,
// not cash that's already in the till -- but in Stock, `highlightSell`
// turns it green, matching that tab's own convention of highlighting the
// selling price as the number that matters at a glance while cost sits
// quietly below it.
export function CatalogEntryCard({
  title,
  cost,
  sell,
  currency,
  unit,
  qty,
  rate,
  highlightSell = false,
  onEditCost,
  onClick,
}: {
  title: string
  // Always USD -- cost is entered and stored in USD regardless of what
  // currency the item sells in (there's no cost-currency picker anywhere
  // in the app), so it's rendered as USD here rather than tagged with the
  // sell-side `currency`.
  cost: number
  sell: number
  currency: Currency
  unit: string
  qty: number
  // LRD-per-USD, needed to convert the USD cost into the sell currency so
  // the markup delta below is an apples-to-apples subtraction.
  rate: number
  highlightSell?: boolean
  // When provided, the cost figure becomes tap-to-edit instead of plain
  // text -- omit to leave it read-only (e.g. a context where there's no
  // single variant to write back to).
  onEditCost?: (next: number) => void
  onClick?: () => void
}) {
  const costInSellCurrency = currency === 'USD' ? cost : cost * rate
  const markup = sell - costInSellCurrency
  return (
    <div className="entry" style={{ width: '100%', display: 'block' }}>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: onClick ? 'pointer' : 'default', display: 'block' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <b style={{ fontSize: 14, fontWeight: 700, color: 'var(--cl-ink)' }}>{title}</b>
          <span className="m" style={{ flexShrink: 0, fontSize: 15, fontWeight: 700, color: highlightSell ? 'var(--cl-usd)' : 'var(--cl-ink)' }}>
            {money(sell, currency)}
          </span>
        </div>
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5, gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
          {onEditCost ? <EditableCost cost={cost} onCommit={onEditCost} /> : (
            <span className="m" style={{ fontSize: 11, color: 'var(--cl-ink-3)' }}>cost {money(cost, 'USD')}</span>
          )}
          {markup > 0 && (
            <span className="m" style={{ fontSize: 11, color: 'var(--cl-ink-3)' }}>→ +{money(markup, currency)} per {unit}</span>
          )}
        </span>
        <span className="m" style={{ flexShrink: 0, fontSize: 11, color: 'var(--cl-ink-3)' }}>
          {qty} {unit}
        </span>
      </div>
    </div>
  )
}
