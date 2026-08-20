import type { Currency } from '../db'
import { money } from '../lib/format'

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
  onClick?: () => void
}) {
  const Comp = onClick ? 'button' : 'div'
  const costInSellCurrency = currency === 'USD' ? cost : cost * rate
  const markup = sell - costInSellCurrency
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className="entry"
      style={{ width: '100%', textAlign: 'left', cursor: onClick ? 'pointer' : undefined, display: 'block' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <b style={{ fontSize: 14, fontWeight: 700, color: 'var(--cl-ink)' }}>{title}</b>
        <span className="m" style={{ flexShrink: 0, fontSize: 15, fontWeight: 700, color: highlightSell ? 'var(--cl-usd)' : 'var(--cl-ink)' }}>
          {money(sell, currency)}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 5, gap: 8 }}>
        <span className="m" style={{ fontSize: 11, color: 'var(--cl-ink-3)' }}>
          cost {money(cost, 'USD')}
          {markup > 0 && <> → +{money(markup, currency)}</>} per {unit}
        </span>
        <span className="m" style={{ flexShrink: 0, fontSize: 11, color: 'var(--cl-ink-3)' }}>
          {qty} {unit}
        </span>
      </div>
    </Comp>
  )
}
