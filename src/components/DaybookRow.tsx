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

  return (
    <div className="flex items-center gap-3 py-2.5">
      <button
        onClick={onEdit}
        disabled={!onEdit}
        className="flex flex-1 items-center gap-3 text-left disabled:cursor-default"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-xs font-bold text-white">
          {sale.qty}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900">
            {sale.itemName}
            {sale.variant ? ` — ${sale.variant}` : ''}
          </div>
          <div className="truncate text-xs text-slate-400">
            {sale.unitType ? `${sale.unitType} · ` : ''}
            {sale.location === 'vishalShop' ? 'Warehouse (Vishal)' : 'Store floor'}
            {sale.tbs ? ` · ${sale.pickedUp ? 'Picked up' : 'TBS'}` : ''}
          </div>
        </div>
        <div className="tabular w-20 shrink-0 text-right text-sm text-slate-700">{lrd > 0 ? money(lrd, 'LRD') : ''}</div>
        <div className="tabular w-20 shrink-0 text-right text-sm font-semibold text-slate-900">{usd > 0 ? money(usd, 'USD') : ''}</div>
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
