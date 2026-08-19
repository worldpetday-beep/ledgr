import type { Currency } from '../db'
import { money } from '../lib/format'

// One product/variant as its own standalone card -- title + price on the
// top line, "cost $X.XX -> +$Y.YY per <unit>" (the markup) on the left of
// the second line, stock on the right. Used by both Sell (search results)
// and Stock (the catalog list) so a SKU reads identically everywhere.
// Price is deliberately plain ink, not the --cl-usd green used for actual
// money-in-hand figures elsewhere (Drawer/Numbers) -- this is a catalog
// price, not cash that's already in the till.
export function CatalogEntryCard({
  title,
  cost,
  sell,
  currency,
  unit,
  qty,
  onClick,
}: {
  title: string
  cost: number
  sell: number
  currency: Currency
  unit: string
  qty: number
  onClick?: () => void
}) {
  const Comp = onClick ? 'button' : 'div'
  const markup = sell - cost
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className="entry"
      style={{ width: '100%', textAlign: 'left', cursor: onClick ? 'pointer' : undefined, display: 'block' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <b style={{ fontSize: 14, fontWeight: 700, color: 'var(--cl-ink)' }}>{title}</b>
        <span className="m" style={{ flexShrink: 0, fontSize: 15, fontWeight: 700, color: 'var(--cl-ink)' }}>
          {money(sell, currency)}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 5, gap: 8 }}>
        <span className="m" style={{ fontSize: 11, color: 'var(--cl-ink-3)' }}>
          cost {money(cost, currency)}
          {markup > 0 && <> → +{money(markup, currency)}</>} per {unit}
        </span>
        <span className="m" style={{ flexShrink: 0, fontSize: 11, color: 'var(--cl-ink-3)' }}>
          {qty} {unit}
        </span>
      </div>
    </Comp>
  )
}
