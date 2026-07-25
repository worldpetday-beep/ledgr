import type { Sale } from '../db'
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
  // A split payment (both currencies present) is shown in neutral ink like
  // before; a single-currency line -- the normal case -- is called out in
  // dark green to read at a glance, closer to how a paid line reads in the
  // physical book.
  const isSplit = lrd > 0 && usd > 0

  return (
    <div className="flex min-w-0 items-center gap-2 py-2.5">
      <button
        onClick={onEdit}
        disabled={!onEdit}
        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-bold text-white">
          {sale.qty}
        </div>
        {/* Name and variant get their own lines (variant indented, smaller)
            instead of one concatenated truncated string -- a long name no
            longer has to fight a variant label for the same line. */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-tight text-slate-900">{sale.itemName}</div>
          {sale.variant && <div className="truncate pl-1.5 text-[11px] leading-tight text-slate-500">— {sale.variant}</div>}
          <div className="truncate text-[11px] leading-tight text-slate-400">
            {sale.unitType ? `${sale.unitType} · ` : ''}
            {sale.location === 'vishalShop' ? 'Warehouse (Vishal)' : 'Store floor'}
            {sale.tbs ? ` · ${sale.pickedUp ? 'Picked up' : 'TBS'}` : ''}
          </div>
        </div>
        <div className="tabular w-[4.5rem] shrink-0 text-right text-xs leading-tight">
          {lrd > 0 && <span className={isSplit ? 'text-slate-600' : 'font-semibold text-green-700'}>{money(lrd, 'LRD')}</span>}
        </div>
        <div className="tabular w-[4.5rem] shrink-0 text-right text-xs leading-tight">
          {usd > 0 && <span className={isSplit ? 'font-semibold text-slate-900' : 'font-semibold text-green-700'}>{money(usd, 'USD')}</span>}
        </div>
      </button>
      {(onDelete || onMarkPickedUp) && (
        <div className="flex shrink-0 items-center gap-1.5">
          {sale.tbs && !sale.pickedUp && onMarkPickedUp && (
            <button onClick={onMarkPickedUp} className="whitespace-nowrap text-xs font-medium text-slate-900 hover:underline">
              Picked up
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} aria-label="Delete item" className="text-slate-400 hover:text-red-600">
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
