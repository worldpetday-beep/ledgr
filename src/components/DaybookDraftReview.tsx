import type { Dispatch, SetStateAction } from 'react'
import type { DaybookDraft, DraftField } from '../lib/ledgerOcr'
import { shopifyInputClass } from './ShopifyShell'
import { TrashIcon } from './icons'

export function countUnverified(draft: DaybookDraft): number {
  let n = 0
  for (const line of draft.lines) {
    if (!line.qty.verified) n++
    if (!line.description.verified) n++
    if (!line.lrdAmount.verified) n++
    if (!line.usdAmount.verified) n++
  }
  const t = draft.totals
  for (const f of [t.totalLrd, t.totalUsd, t.outboundLrd, t.outboundUsd, t.handCashLrd, t.handCashUsd]) {
    if (!f.verified) n++
  }
  return n
}

function FlagDot({ verified }: { verified: boolean }) {
  if (verified) return null
  return <span className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-label="Needs review" />
}

function fieldInputClass(f: DraftField<unknown>): string {
  return f.verified ? shopifyInputClass : shopifyInputClass + ' !border-amber-400 !bg-amber-50'
}

export function DaybookDraftReview({
  draft,
  setDraft,
  imageUrl,
  onVerify,
  onApprove,
  onDiscard,
  approving,
}: {
  draft: DaybookDraft
  setDraft: Dispatch<SetStateAction<DaybookDraft | null>>
  imageUrl: string
  onVerify: () => void
  onApprove: () => void
  onDiscard: () => void
  approving: boolean
}) {
  const unverifiedCount = countUnverified(draft)

  function updateLine(key: string, patch: Partial<{ qty: number; description: string; lrdAmount: number; usdAmount: number }>) {
    setDraft((d) => {
      if (!d) return d
      return {
        ...d,
        lines: d.lines.map((l) => {
          if (l.key !== key) return l
          const next = { ...l }
          if (patch.qty !== undefined) next.qty = { ...l.qty, value: patch.qty, verified: true }
          if (patch.description !== undefined) next.description = { ...l.description, value: patch.description, verified: true }
          if (patch.lrdAmount !== undefined) next.lrdAmount = { ...l.lrdAmount, value: patch.lrdAmount, verified: true }
          if (patch.usdAmount !== undefined) next.usdAmount = { ...l.usdAmount, value: patch.usdAmount, verified: true }
          return next
        }),
      }
    })
  }

  function removeLine(key: string) {
    setDraft((d) => (d ? { ...d, lines: d.lines.filter((l) => l.key !== key) } : d))
  }

  function updateTotal(name: keyof DaybookDraft['totals'], value: number) {
    setDraft((d) => (d ? { ...d, totals: { ...d.totals, [name]: { ...d.totals[name], value, verified: true } } } : d))
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="shrink-0 bg-gray-100 px-4 py-3">
        <img src={imageUrl} alt="Captured ledger page" className="mx-auto max-h-64 w-full rounded-lg object-contain" />
      </div>

      <div className="flex flex-1 flex-col gap-4 px-4 py-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Page date</label>
          <input
            type="date"
            className={shopifyInputClass}
            value={draft.pageDate ?? ''}
            onChange={(e) => setDraft((d) => (d ? { ...d, pageDate: e.target.value } : d))}
          />
          {!draft.pageDate && <p className="mt-1 text-xs text-amber-600">Date wasn't readable — defaulting lines to today unless you set one.</p>}
        </div>

        {unverifiedCount > 0 && (
          <button
            onClick={onVerify}
            className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left"
          >
            <span className="text-sm font-semibold text-amber-800">{unverifiedCount} field{unverifiedCount === 1 ? '' : 's'} need verification</span>
            <span className="text-sm font-medium text-amber-700">Fix now →</span>
          </button>
        )}

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-black">Line items ({draft.lines.length})</h2>
          {draft.lines.map((line) => (
            <div key={line.key} className="rounded-xl border border-gray-100 p-3">
              <div className="flex items-center gap-2">
                <div className="w-16 shrink-0">
                  <label className="mb-1 flex items-center text-[10px] font-semibold uppercase text-gray-400">
                    Qty <FlagDot verified={line.qty.verified} />
                  </label>
                  <input
                    type="number"
                    min={1}
                    className={fieldInputClass(line.qty)}
                    value={line.qty.value}
                    onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) || 1 })}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <label className="mb-1 flex items-center text-[10px] font-semibold uppercase text-gray-400">
                    Description <FlagDot verified={line.description.verified} />
                  </label>
                  <input
                    className={fieldInputClass(line.description)}
                    value={line.description.value}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                  />
                </div>
                <button onClick={() => removeLine(line.key)} aria-label="Remove line" className="mt-4 shrink-0 text-gray-400 hover:text-red-600">
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 flex items-center text-[10px] font-semibold uppercase text-gray-400">
                    LRD <FlagDot verified={line.lrdAmount.verified} />
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={fieldInputClass(line.lrdAmount)}
                    value={line.lrdAmount.value || ''}
                    placeholder="0.00"
                    onChange={(e) => updateLine(line.key, { lrdAmount: Number(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center text-[10px] font-semibold uppercase text-gray-400">
                    USD <FlagDot verified={line.usdAmount.verified} />
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={fieldInputClass(line.usdAmount)}
                    value={line.usdAmount.value || ''}
                    placeholder="0.00"
                    onChange={(e) => updateLine(line.key, { usdAmount: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>
            </div>
          ))}
          {draft.lines.length === 0 && <p className="text-sm text-gray-500">No line items detected — add them manually in Record Sale instead.</p>}
        </div>

        <div className="rounded-xl border border-gray-100 p-3">
          <h2 className="mb-2 text-sm font-semibold text-black">Closing totals</h2>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['totalLrd', 'Total LRD'],
                ['totalUsd', 'Total USD'],
                ['outboundLrd', 'Outbound LRD'],
                ['outboundUsd', 'Outbound USD'],
                ['handCashLrd', 'Hand cash LRD'],
                ['handCashUsd', 'Hand cash USD'],
              ] as [keyof DaybookDraft['totals'], string][]
            ).map(([key, label]) => (
              <div key={key}>
                <label className="mb-1 flex items-center text-[10px] font-semibold uppercase text-gray-400">
                  {label} <FlagDot verified={draft.totals[key].verified} />
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={fieldInputClass(draft.totals[key])}
                  value={draft.totals[key].value || ''}
                  placeholder="0.00"
                  onChange={(e) => updateTotal(key, Number(e.target.value) || 0)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-gray-100 bg-white px-4 py-3">
        <button
          onClick={onApprove}
          disabled={approving || draft.lines.length === 0}
          className="w-full rounded-lg bg-black py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {approving ? 'Pushing…' : 'Approve & Push to Ledger'}
        </button>
        <button onClick={onDiscard} disabled={approving} className="w-full text-sm font-medium text-gray-500">
          Discard scan
        </button>
      </div>
    </div>
  )
}
