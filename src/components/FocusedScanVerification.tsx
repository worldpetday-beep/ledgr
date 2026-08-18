import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Bbox, DaybookDraft } from '../lib/ledgerOcr'
import type { PageImage } from './DaybookDraftReview'

type FieldRef =
  | { kind: 'line'; lineKey: string; field: 'qty' | 'description' | 'lrdAmount' | 'usdAmount' }
  | { kind: 'total'; field: keyof DaybookDraft['totals'] }

interface FlaggedItem {
  ref: FieldRef
  summaryLabel: string
  fieldLabel: string
  value: string | number
  bbox: Bbox | null
  pageIndex: number
  inputType: 'text' | 'number'
}

const TOTALS_META: [keyof DaybookDraft['totals'], string][] = [
  ['totalLrd', 'Total LRD'],
  ['totalUsd', 'Total USD'],
  ['outboundLrd', 'Outbound LRD'],
  ['outboundUsd', 'Outbound USD'],
  ['handCashLrd', 'Hand Cash LRD'],
  ['handCashUsd', 'Hand Cash USD'],
]

function summarize(text: string, max = 40): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

function buildFlaggedList(draft: DaybookDraft): FlaggedItem[] {
  const items: FlaggedItem[] = []
  draft.lines.forEach((line) => {
    const summaryLabel = `(${line.qty.value}) ${summarize(line.description.value || 'Item')} - $${line.usdAmount.value || line.lrdAmount.value || '...'}`
    if (!line.qty.verified) {
      items.push({ ref: { kind: 'line', lineKey: line.key, field: 'qty' }, summaryLabel, fieldLabel: 'Quantity', value: line.qty.value, bbox: line.qty.bbox ?? line.bbox, pageIndex: line.pageIndex, inputType: 'number' })
    }
    if (!line.description.verified) {
      items.push({ ref: { kind: 'line', lineKey: line.key, field: 'description' }, summaryLabel, fieldLabel: 'Item Description', value: line.description.value, bbox: line.description.bbox ?? line.bbox, pageIndex: line.pageIndex, inputType: 'text' })
    }
    if (!line.lrdAmount.verified) {
      items.push({ ref: { kind: 'line', lineKey: line.key, field: 'lrdAmount' }, summaryLabel, fieldLabel: 'Price (LRD)', value: line.lrdAmount.value, bbox: line.lrdAmount.bbox ?? line.bbox, pageIndex: line.pageIndex, inputType: 'number' })
    }
    if (!line.usdAmount.verified) {
      items.push({ ref: { kind: 'line', lineKey: line.key, field: 'usdAmount' }, summaryLabel, fieldLabel: 'Price (USD)', value: line.usdAmount.value, bbox: line.usdAmount.bbox ?? line.bbox, pageIndex: line.pageIndex, inputType: 'number' })
    }
  })
  for (const [key, label] of TOTALS_META) {
    const f = draft.totals[key]
    // Closing totals aren't tied to a specific line, so they zoom into
    // whichever snapshot is the last one (totals are usually written at the
    // bottom of the final page photographed that day).
    if (!f.verified) items.push({ ref: { kind: 'total', field: key }, summaryLabel: 'Closing totals', fieldLabel: label, value: f.value, bbox: f.bbox, pageIndex: -1, inputType: 'number' })
  }
  return items
}

function applyFieldValue(draft: DaybookDraft, ref: FieldRef, raw: string): DaybookDraft {
  if (ref.kind === 'total') {
    const value = Number(raw) || 0
    return { ...draft, totals: { ...draft.totals, [ref.field]: { ...draft.totals[ref.field], value, verified: true } } }
  }
  return {
    ...draft,
    lines: draft.lines.map((l) => {
      if (l.key !== ref.lineKey) return l
      if (ref.field === 'description') return { ...l, description: { ...l.description, value: raw, verified: true } }
      const value = Number(raw) || 0
      return { ...l, [ref.field]: { ...l[ref.field], value, verified: true } }
    }),
  }
}

// Zooms/crops the source photo to the flagged field's bounding box (with
// generous padding for context) via a scaled+translated <img>, so the user
// never has to pinch, scroll, or leave the app to read the source line.
function CropZoom({ imageUrl, imageWidth, imageHeight, bbox }: { imageUrl: string; imageWidth: number; imageHeight: number; bbox: Bbox | null }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [imgStyle, setImgStyle] = useState<CSSProperties>({})
  const [highlightStyle, setHighlightStyle] = useState<CSSProperties>({})

  useEffect(() => {
    const el = containerRef.current
    if (!el || !bbox || !imageWidth || !imageHeight) return
    const rect = el.getBoundingClientRect()
    const padX = Math.max(30, (bbox.x1 - bbox.x0) * 0.6)
    const padY = Math.max(50, (bbox.y1 - bbox.y0) * 2.2)
    const cropX0 = Math.max(0, bbox.x0 - padX)
    const cropY0 = Math.max(0, bbox.y0 - padY)
    const cropX1 = Math.min(imageWidth, bbox.x1 + padX)
    const cropY1 = Math.min(imageHeight, bbox.y1 + padY)
    const cropW = Math.max(1, cropX1 - cropX0)
    const cropH = Math.max(1, cropY1 - cropY0)
    const scale = Math.min(rect.width / cropW, rect.height / cropH)

    setImgStyle({
      position: 'absolute',
      left: 0,
      top: 0,
      width: imageWidth * scale,
      height: imageHeight * scale,
      maxWidth: 'none',
      transform: `translate(${-cropX0 * scale}px, ${-cropY0 * scale}px)`,
    })
    setHighlightStyle({
      position: 'absolute',
      left: (bbox.x0 - cropX0) * scale,
      top: (bbox.y0 - cropY0) * scale,
      width: (bbox.x1 - bbox.x0) * scale,
      height: (bbox.y1 - bbox.y0) * scale,
    })
  }, [bbox, imageWidth, imageHeight])

  return (
    <div ref={containerRef} className="relative h-52 w-full overflow-hidden bg-gray-900">
      <img src={imageUrl} alt="Zoomed ledger line" style={imgStyle} />
      {bbox && <div style={highlightStyle} className="rounded border-2 border-dashed border-red-500" />}
    </div>
  )
}

export function FocusedScanVerification({
  draft,
  images,
  onDone,
}: {
  draft: DaybookDraft
  images: PageImage[]
  onDone: (updated: DaybookDraft) => void
}) {
  // Frozen at entry so stepping through doesn't reshuffle mid-flow.
  const flagged = useMemo(() => buildFlaggedList(draft), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0)
  const [workingDraft, setWorkingDraft] = useState(draft)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const current = flagged[index]
  const currentImage = current ? images[current.pageIndex >= 0 ? current.pageIndex : images.length - 1] ?? images[0] : images[0]

  useEffect(() => {
    if (current) setInputValue(String(current.value))
    setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 50)
  }, [index]) // eslint-disable-line react-hooks/exhaustive-deps

  function commitAndAdvance() {
    if (!current) return
    const updated = applyFieldValue(workingDraft, current.ref, inputValue)
    setWorkingDraft(updated)
    if (index + 1 >= flagged.length) {
      onDone(updated)
    } else {
      setIndex(index + 1)
    }
  }

  if (!current) return null

  return (
    <div className="fixed inset-0 z-[60] flex flex-col [background:var(--cl-card)]">
      {/* Top split: zoomed crop of the current line, matching how a physical ledger page looks */}
      <div className="relative shrink-0">
        <CropZoom imageUrl={currentImage.url} imageWidth={currentImage.width} imageHeight={currentImage.height} bbox={current.bbox} />
        <div className="absolute left-3 top-3 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 shadow">
          Verification Required: {current.fieldLabel}
        </div>
      </div>

      {/* Bottom split: stepper form with autofocused input + Next Field */}
      <div className="flex flex-1 flex-col overflow-y-auto rounded-t-2xl border-t [border-color:var(--cl-line)] [background:var(--cl-card)] px-4 pb-4 pt-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <h2 className="text-base font-semibold [color:var(--cl-ink)]">
          Entry Verification {index + 1} / {flagged.length}
        </h2>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full [background:var(--cl-line-2)]">
          <div className="h-full rounded-full [background:var(--cl-ink)] transition-all" style={{ width: `${((index + 1) / flagged.length) * 100}%` }} />
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          {flagged.slice(0, index).map((item, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border [border-color:var(--cl-line)] px-3 py-2 text-sm">
              <span className="min-w-0 truncate [color:var(--cl-ink-2)]">
                {item.fieldLabel} — {summarize(item.summaryLabel, 30)}
              </span>
              <span className="shrink-0 text-xs font-semibold text-green-600">Verified</span>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border [border-color:var(--cl-line)] p-3">
          <div className="text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">{current.summaryLabel}</div>
          <label className="mt-2 flex items-center gap-2 rounded-lg border-2 border-black [background:var(--cl-line-2)] px-3 py-2.5">
            <span className="shrink-0 text-sm font-bold [color:var(--cl-ink)]">{current.fieldLabel}</span>
            <input
              ref={inputRef}
              className="w-full bg-transparent text-base font-semibold [color:var(--cl-ink)] outline-none"
              type={current.inputType === 'number' ? 'number' : 'text'}
              inputMode={current.inputType === 'number' ? 'decimal' : 'text'}
              step={current.inputType === 'number' ? '0.01' : undefined}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commitAndAdvance()}
            />
          </label>
        </div>

        <button onClick={commitAndAdvance} className="mt-4 w-full rounded-lg [background:var(--cl-ink)] py-3.5 text-base font-bold text-white">
          Next Field
        </button>
      </div>
    </div>
  )
}

