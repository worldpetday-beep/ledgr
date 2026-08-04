import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { BottomSheet, Button } from './ui'
import { formatTimeMonrovia } from '../lib/format'

export interface TicketLineSummary {
  key: string
  label: string
  amounts: string
}

// A fixed, non-editable banner showing the last two already-recorded sales
// so the user can visually confirm what was just logged before pushing a
// new one -- the main guard against accidentally re-entering the same
// ledger line twice in a row. Lives on the main Record Sale entry screen
// (RecordSaleSheet), not this confirm step, so it's visible from the moment
// entry starts rather than only surfacing right before saving.
export function RecentSalesReference() {
  const recent = useLiveQuery(() => db.sales.orderBy('timestamp').reverse().filter((s) => !s.voidedAt).limit(2).toArray(), [])
  if (!recent || recent.length === 0) return null

  return (
    <div className="mb-3 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--page-plane)] px-3 py-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Last logged (reference only — not editable here)
      </div>
      <div className="flex flex-col gap-1">
        {recent.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
            <span className="min-w-0 truncate">
              #{s.customerNumber} · {s.itemName} × {s.qty}
            </span>
            <span className="tabular shrink-0">{formatTimeMonrovia(s.timestamp)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// The sale confirmation pop-up: a centered, keyboard-safe review step between
// filling out a ticket and actually writing it to the ledger, topped with a
// read-only snapshot of the last two sales so a duplicate entry gets caught
// before it's saved rather than after.
export function LedgerPushReviewPanel({
  open,
  onClose,
  onConfirm,
  saving,
  lineSummaries,
  grandTotal,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  saving: boolean
  lineSummaries: TicketLineSummary[]
  grandTotal: string
}) {
  return (
    <BottomSheet open={open} onClose={() => !saving && onClose()} centered>
      <h2 className="text-base font-semibold">Confirm this sale?</h2>
      <div className="mt-3 flex flex-col gap-1.5">
        {lineSummaries.map((l) => (
          <div key={l.key} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{l.label}</span>
            <span className="tabular shrink-0 text-[var(--text-muted)]">{l.amounts}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-[var(--gridline)] pt-3">
        <span className="text-sm font-semibold">Grand Total</span>
        <span className="tabular text-base font-bold">{grandTotal}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving} className="flex-1 justify-center">
          Back
        </Button>
        <Button onClick={onConfirm} disabled={saving} className="flex-1 justify-center">
          {saving ? 'Saving…' : 'Confirm & Record'}
        </Button>
      </div>
    </BottomSheet>
  )
}
