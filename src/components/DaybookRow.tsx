import { useLiveQuery } from 'dexie-react-hooks'
import { db, profitOf, type Sale } from '../db'
import { money } from '../lib/format'
import { lrdAmountOf, usdAmountOf } from '../lib/salesLedger'
import { TrashIcon } from './icons'

// A single ledger line mirroring a physical daybook sheet: a circular qty
// badge, the item/variant descriptor, and two fixed-width right-aligned
// currency columns (LRD then USD) that stay blank when unused, so amounts
// line up in neat columns down the whole page regardless of currency mix.
// Tapping the row (when onEdit is provided) opens it for editing — this
// works for both today's live ledger and past archived days.
export function DaybookRow({
  sale,
  onEdit,
  onDelete,
  onMarkPickedUp,
}: {
  sale: Sale
  onEdit?: () => void
  onDelete?: () => void
  onMarkPickedUp?: () => void
}) {
  const lrd = lrdAmountOf(sale)
  const usd = usdAmountOf(sale)

  // Live current stock for the "[ N left ]" badge, and whether cost is
  // actually known for this variant right now -- profit is computed from
  // the sale's own frozen costAtSale (what cost genuinely was at sale
  // time), but the margin check itself is bypassed whenever the variant
  // has no known cost, so a never-priced free-text item never shows a
  // fabricated "full revenue as profit" figure.
  const variant = useLiveQuery(() => (sale.variantId ? db.variants.get(sale.variantId) : undefined), [sale.variantId])
  const stockRemaining = variant ? variant.stockMyShop + variant.stockVishalShop : null
  const profit = variant && !variant.costUnknown ? profitOf(sale) : null

  return (
    <div className="flex min-w-0 items-center gap-2 py-2.5">
      <button
        onClick={onEdit}
        disabled={!onEdit}
        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full [background:var(--cl-ink)] text-[11px] font-bold text-white">
          {sale.qty}
        </div>
        {/* Name and variant get their own lines (variant indented, smaller)
            instead of one concatenated truncated string -- a long name no
            longer has to fight a variant label for the same line. */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-tight [color:var(--cl-ink)]">{sale.itemName}</div>
          {sale.variant && <div className="truncate pl-1.5 text-[11px] leading-tight [color:var(--cl-ink-2)]">— {sale.variant}</div>}
          <div className="truncate text-[11px] leading-tight [color:var(--cl-ink-3)]">
            {sale.unitType ? `${sale.unitType} · ` : ''}
            {sale.location === 'vishalShop' ? 'Warehouse (Vishal)' : 'Store floor'}
            {sale.tbs ? ` · ${sale.pickedUp ? 'Picked up' : 'TBS'}` : ''}
          </div>
          {stockRemaining !== null && (
            <div className="truncate text-[10px] leading-tight [color:var(--cl-ink-3)]">[ {stockRemaining} left ]</div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end">
          {profit !== null && (
            <span className="leading-tight font-semibold" style={{ color: '#00875A', opacity: 0.8, fontSize: '9px' }}>
              {money(profit, sale.currency)}
            </span>
          )}
          <div className="flex items-center gap-1">
            <div className="tabular w-[4.5rem] shrink-0 text-right text-xs leading-tight" style={{ color: '#000000' }}>
              {lrd > 0 && money(lrd, 'LRD')}
            </div>
            <div className="tabular w-[4.5rem] shrink-0 text-right text-xs font-semibold leading-tight" style={{ color: '#000000' }}>
              {usd > 0 && money(usd, 'USD')}
            </div>
          </div>
        </div>
      </button>
      {(onDelete || onMarkPickedUp) && (
        <div className="flex shrink-0 items-center gap-1.5">
          {sale.tbs && !sale.pickedUp && onMarkPickedUp && (
            <button onClick={onMarkPickedUp} className="whitespace-nowrap text-xs font-medium [color:var(--cl-ink)] hover:underline">
              Picked up
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} aria-label="Delete item" className="[color:var(--cl-ink-3)] hover:text-red-600">
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
