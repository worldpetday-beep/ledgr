import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { addAbbreviationRule } from '../lib/abbreviations'
import type { Bbox, DaybookDraft, DraftField, DraftLine } from '../lib/ledgerOcr'
import { shopifyInputClass } from './ShopifyShell'
import { AlertIcon, PlusIcon, TrashIcon } from './icons'

export interface PageImage {
  url: string
  width: number
  height: number
}

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

// Renders the active page's source photo with a high-contrast box drawn
// exactly over the tapped line's OCR bounding box -- recomputed against the
// rendered (letterboxed, `object-contain`) image size, not the natural one,
// so the box tracks the real on-screen position of the source text.
function HighlightedPage({ image, bbox }: { image: PageImage; bbox: Bbox | null }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  function recompute() {
    const el = containerRef.current
    if (!el || !bbox) {
      setRect(null)
      return
    }
    const cw = el.clientWidth
    const ch = el.clientHeight
    const scale = Math.min(cw / image.width, ch / image.height)
    const offsetX = (cw - image.width * scale) / 2
    const offsetY = (ch - image.height * scale) / 2
    setRect({
      left: offsetX + bbox.x0 * scale,
      top: offsetY + bbox.y0 * scale,
      width: Math.max(4, (bbox.x1 - bbox.x0) * scale),
      height: Math.max(4, (bbox.y1 - bbox.y0) * scale),
    })
  }

  useEffect(recompute) // recompute on every render: bbox/image/container size all can change
  useEffect(() => {
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={containerRef} className="relative h-56 w-full sm:h-full">
      <img src={image.url} alt="Ledger page" className="h-full w-full object-contain" onLoad={recompute} />
      {rect && (
        <div
          className="pointer-events-none absolute rounded-sm border-[3px] border-red-500 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)] transition-all duration-150"
          style={rect}
        />
      )}
    </div>
  )
}

// Inline searchable catalog picker shown when a description contains
// shorthand not found in the abbreviation map. Picking an entry both fixes
// this line and teaches the alias engine the raw text for next time.
function AliasPicker({ rawText, onPick }: { rawText: string; onPick: (name: string) => void }) {
  const [query, setQuery] = useState('')
  const products = useLiveQuery(() => db.products.toArray(), []) ?? []
  const matches = products
    .filter((p) => !p.archived && (query ? p.name.toLowerCase().includes(query.toLowerCase()) : true))
    .slice(0, 6)

  return (
    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
        <AlertIcon className="h-3.5 w-3.5" />
        Unrecognized shorthand — match it to a catalog item
      </div>
      <input
        className="mt-1.5 w-full rounded-md border border-amber-300 [background:var(--cl-card)] px-2 py-1.5 text-sm [color:var(--cl-ink)] outline-none"
        placeholder={`Search catalog for "${rawText}"…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.name)}
              className="rounded-md px-2 py-1.5 text-left text-sm [color:var(--cl-ink)] hover:bg-amber-100"
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      {query && matches.length === 0 && <p className="mt-1.5 text-xs text-amber-700">No catalog match — edit the text directly instead.</p>}
    </div>
  )
}

export function DaybookDraftReview({
  draft,
  setDraft,
  images,
  onAddPage,
  pagesUsed,
  maxPages,
  onVerify,
  onApprove,
  onDiscard,
  approving,
  error,
}: {
  draft: DaybookDraft
  setDraft: Dispatch<SetStateAction<DaybookDraft | null>>
  images: PageImage[]
  onAddPage?: (file: File) => void
  pagesUsed: number
  maxPages: number
  onVerify: () => void
  onApprove: () => void
  onDiscard: () => void
  approving: boolean
  error?: string | null
}) {
  const unverifiedCount = countUnverified(draft)
  const [activeLineKey, setActiveLineKey] = useState<string | null>(null)

  const activeLine = draft.lines.find((l) => l.key === activeLineKey) ?? null
  const activeImage = images[activeLine?.pageIndex ?? 0] ?? images[0]

  function updateLine(key: string, patch: Partial<{ qty: number; description: string; lrdAmount: number; usdAmount: number; aliasResolved: boolean }>) {
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
          if (patch.aliasResolved !== undefined) next.aliasResolved = patch.aliasResolved
          return next
        }),
      }
    })
  }

  async function resolveAliasWithProduct(line: DraftLine, productName: string) {
    await addAbbreviationRule(line.description.value, productName)
    updateLine(line.key, { description: productName, aliasResolved: true })
  }

  function removeLine(key: string) {
    setDraft((d) => (d ? { ...d, lines: d.lines.filter((l) => l.key !== key) } : d))
    if (activeLineKey === key) setActiveLineKey(null)
  }

  function updateTotal(name: keyof DaybookDraft['totals'], value: number) {
    setDraft((d) => (d ? { ...d, totals: { ...d.totals, [name]: { ...d.totals[name], value, verified: true } } } : d))
  }

  return (
    <div className="flex max-w-full flex-1 flex-col overflow-hidden sm:flex-row" style={{ boxSizing: 'border-box' }}>
      {/* Source page preview, synced to whichever line is tapped in the feed */}
      <div className="shrink-0 bg-slate-900 sm:sticky sm:top-0 sm:h-full sm:w-[42%]">
        {activeImage && <HighlightedPage image={activeImage} bbox={activeLine?.bbox ?? null} />}
        {images.length > 1 && (
          <div className="flex gap-1.5 bg-slate-900 px-2 pb-2">
            {images.map((_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i === (activeLine?.pageIndex ?? 0) ? '[background:var(--cl-card)]' : 'bg-slate-600'}`} />
            ))}
          </div>
        )}
      </div>

      <div className="flex max-w-full flex-1 flex-col gap-4 overflow-y-auto px-4 py-4" style={{ boxSizing: 'border-box' }}>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Page date</label>
          <input
            type="date"
            className={shopifyInputClass}
            value={draft.pageDate ?? ''}
            onChange={(e) => setDraft((d) => (d ? { ...d, pageDate: e.target.value } : d))}
          />
          {!draft.pageDate && <p className="mt-1 text-xs text-amber-600">Date wasn't readable — defaulting lines to today unless you set one.</p>}
        </div>

        {onAddPage && (
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed [border-color:var(--cl-line)] [background:var(--cl-line-2)] px-4 py-3 text-sm font-semibold [color:var(--cl-ink-2)]">
            <PlusIcon className="h-4 w-4" />
            Add another snapshot ({pagesUsed}/{maxPages})
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onAddPage(file)
              }}
            />
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

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
          <h2 className="text-sm font-semibold [color:var(--cl-ink)]">
            Line items ({draft.lines.length}){images.length > 1 ? ` across ${images.length} pages` : ''}
          </h2>
          {draft.lines.map((line) => (
            <div
              key={line.key}
              onClick={() => setActiveLineKey(line.key)}
              className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                activeLineKey === line.key ? 'border-slate-900 [background:var(--cl-line-2)]' : '[border-color:var(--cl-line)] [background:var(--cl-card)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-16 shrink-0">
                  <label className="mb-1 flex items-center text-[10px] font-semibold uppercase [color:var(--cl-ink-3)]">
                    Qty <FlagDot verified={line.qty.verified} />
                  </label>
                  <input
                    type="number"
                    min={1}
                    className={fieldInputClass(line.qty)}
                    value={line.qty.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) || 1 })}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <label className="mb-1 flex items-center text-[10px] font-semibold uppercase [color:var(--cl-ink-3)]">
                    Description <FlagDot verified={line.description.verified} />
                  </label>
                  <input
                    className={`${fieldInputClass(line.description)} ${!line.aliasResolved ? '!border-yellow-400 !bg-yellow-50' : ''}`}
                    value={line.description.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateLine(line.key, { description: e.target.value, aliasResolved: true })}
                  />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    removeLine(line.key)
                  }}
                  aria-label="Remove line"
                  className="mt-4 shrink-0 [color:var(--cl-ink-3)] hover:text-red-600"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>

              {!line.aliasResolved && (
                <div onClick={(e) => e.stopPropagation()}>
                  <AliasPicker rawText={line.description.value} onPick={(name) => resolveAliasWithProduct(line, name)} />
                </div>
              )}

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 flex items-center text-[10px] font-semibold uppercase [color:var(--cl-ink-3)]">
                    LRD <FlagDot verified={line.lrdAmount.verified} />
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={fieldInputClass(line.lrdAmount)}
                    value={line.lrdAmount.value || ''}
                    placeholder="0.00"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateLine(line.key, { lrdAmount: Number(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center text-[10px] font-semibold uppercase [color:var(--cl-ink-3)]">
                    USD <FlagDot verified={line.usdAmount.verified} />
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={fieldInputClass(line.usdAmount)}
                    value={line.usdAmount.value || ''}
                    placeholder="0.00"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateLine(line.key, { usdAmount: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>
            </div>
          ))}
          {draft.lines.length === 0 && <p className="text-sm [color:var(--cl-ink-2)]">No line items detected — add them manually in Record Sale instead.</p>}
        </div>

        <div className="rounded-xl border [border-color:var(--cl-line)] p-3">
          <h2 className="mb-2 text-sm font-semibold [color:var(--cl-ink)]">Closing totals</h2>
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
                <label className="mb-1 flex items-center text-[10px] font-semibold uppercase [color:var(--cl-ink-3)]">
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

      <div className="sticky bottom-0 flex shrink-0 flex-col gap-2 border-t [border-color:var(--cl-line)] [background:var(--cl-card)] px-4 py-3 sm:absolute sm:inset-x-0 sm:bottom-0">
        <button
          onClick={onApprove}
          disabled={approving || draft.lines.length === 0}
          className="w-full rounded-lg bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {approving ? 'Pushing…' : 'Approve & Push to Ledger'}
        </button>
        <button onClick={onDiscard} disabled={approving} className="w-full text-sm font-medium [color:var(--cl-ink-2)]">
          Discard scan
        </button>
      </div>
    </div>
  )
}
