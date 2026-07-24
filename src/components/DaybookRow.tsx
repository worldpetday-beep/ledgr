import type { Sale } from '../db'
import { money } from '../lib/format'
import { lrdAmountOf, usdAmountOf } from '../lib/salesLedger'
import { TrashIcon } from './icons'

// A single ledger line mirroring a physical daybook sheet: a circular qty
// badge, the item/variant descriptor, and two fixed-width right-aligned
// currency columns (LRD then USD) that stay blank when unused, so amounts
// line up in neat columns down the whole page regardless of currency mix.
export function DaybookRow({
  sale,
  onDelete,
  onMarkPickedUp,
}: {
  sale: Sale
  onDelete?: () => void
  onMarkPickedUp?: () => void
}) {
  const lrd = lrdAmountOf(sale)
  const usd = usdAmountOf(sale)
  const readOnly = !onDelete

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-xs font-bold text-white">
        {sale.qty}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-black">
          {sale.itemName}
          {sale.variant ? ` — ${sale.variant}` : ''}
        </div>
        <div className="truncate text-xs text-gray-400">
          {sale.unitType ? `${sale.unitType} · ` : ''}
          {sale.location === 'vishalShop' ? 'Warehouse (Vishal)' : 'Store floor'}
          {sale.tbs ? ` · ${sale.pickedUp ? 'Picked up' : 'TBS'}` : ''}
        </div>
      </div>
      <div className="tabular w-20 shrink-0 text-right text-sm text-gray-700">{lrd > 0 ? money(lrd, 'LRD') : ''}</div>
      <div className="tabular w-20 shrink-0 text-right text-sm font-semibold text-black">{usd > 0 ? money(usd, 'USD') : ''}</div>
      {!readOnly && (
        <div className="flex shrink-0 items-center gap-1.5">
          {sale.tbs && !sale.pickedUp && onMarkPickedUp && (
            <button onClick={onMarkPickedUp} className="whitespace-nowrap text-xs font-medium text-black hover:underline">
              Picked up
            </button>
          )}
          <button onClick={onDelete} aria-label="Delete item" className="text-gray-400 hover:text-red-600">
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
