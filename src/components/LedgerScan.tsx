import { useState } from 'react'
import { db, reserveNextCustomerNumber, reserveNextOrderNumber, type Currency } from '../db'
import { recognizeLedgerImage, parseLedgerDraft, type DaybookDraft, type DraftField, type DraftTotals } from '../lib/ledgerOcr'
import { applyAliasesToDraftLines } from '../lib/abbreviations'
import { DaybookDraftReview, type PageImage } from './DaybookDraftReview'
import { FocusedScanVerification } from './FocusedScanVerification'
import { ChevronLeftIcon } from './icons'

type Stage = 'upload' | 'processing' | 'review' | 'verify'
const MAX_PAGES = 3

// A closing-totals field only really lives on one physical page (usually
// the last one photographed). When merging snapshots, keep whichever side
// actually found a value instead of letting a later blank page zero out an
// earlier confirmed read.
function mergeTotalField<T>(a: DraftField<T>, b: DraftField<T>): DraftField<T> {
  if (b.verified && !a.verified) return b
  return a
}

function mergeTotals(a: DraftTotals, b: DraftTotals): DraftTotals {
  return {
    totalLrd: mergeTotalField(a.totalLrd, b.totalLrd),
    totalUsd: mergeTotalField(a.totalUsd, b.totalUsd),
    outboundLrd: mergeTotalField(a.outboundLrd, b.outboundLrd),
    outboundUsd: mergeTotalField(a.outboundUsd, b.outboundUsd),
    handCashLrd: mergeTotalField(a.handCashLrd, b.handCashLrd),
    handCashUsd: mergeTotalField(a.handCashUsd, b.handCashUsd),
  }
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3">
      <button onClick={onBack} aria-label="Back" className="text-black">
        <ChevronLeftIcon className="h-5 w-5" />
      </button>
      <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
    </div>
  )
}

function getImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = url
  })
}

// Commits every line in the draft to the permanent sales history: each row
// becomes its own order (a scanned ledger page has no reliable way to tell
// which lines belonged to the same customer), resolving/creating a
// product+variant by description exactly like a manual free-text sale, and
// deducting store-floor stock the same way Record Sale does.
async function pushDraftToLedger(draft: DaybookDraft): Promise<number> {
  const timestampBase = draft.pageDate ? new Date(`${draft.pageDate}T12:00:00`).getTime() : Date.now()
  let committed = 0

  await db.transaction('rw', db.sales, db.products, db.variants, db.settings, db.drawerCounts, async () => {
    for (const line of draft.lines) {
      const name = line.description.value.trim()
      if (!name || (line.lrdAmount.value <= 0 && line.usdAmount.value <= 0)) continue

      const primaryCurrency: Currency = line.usdAmount.value > 0 ? 'USD' : 'LRD'
      const primaryAmount = primaryCurrency === 'USD' ? line.usdAmount.value : line.lrdAmount.value
      const hasSecondary = line.usdAmount.value > 0 && line.lrdAmount.value > 0

      const now = Date.now()
      let productId: number
      let variantId: number
      let productCategory = 'General'
      let variantLabel = 'Standard'

      const existingProduct = await db.products.where('name').equalsIgnoreCase(name).first()
      if (existingProduct) {
        productId = existingProduct.id!
        productCategory = existingProduct.category
        const existingVariants = await db.variants.where('productId').equals(existingProduct.id!).toArray()
        if (existingVariants.length >= 1) {
          variantId = existingVariants[0].id!
          variantLabel = existingVariants[0].label
        } else {
          variantId = (await db.variants.add({
            productId,
            label: 'Standard',
            optionValues: [],
            costPrice: 0,
            costUnknown: true,
            sellPrice: line.qty.value > 0 ? primaryAmount / line.qty.value : primaryAmount,
            currency: primaryCurrency,
            stockMyShop: 0,
            stockVishalShop: 0,
            lowStockThreshold: 3,
            order: 0,
            createdAt: now,
            updatedAt: now,
          })) as number
        }
      } else {
        productId = (await db.products.add({
          name,
          category: 'General',
          description: '',
          images: [],
          options: [],
          archived: false,
          createdAt: now,
          updatedAt: now,
        })) as number
        variantId = (await db.variants.add({
          productId,
          label: 'Standard',
          optionValues: [],
          costPrice: 0,
          costUnknown: true,
          sellPrice: line.qty.value > 0 ? primaryAmount / line.qty.value : primaryAmount,
          currency: primaryCurrency,
          stockMyShop: 0,
          stockVishalShop: 0,
          lowStockThreshold: 3,
          order: 0,
          createdAt: now,
          updatedAt: now,
        })) as number
      }

      const customerNumber = await reserveNextCustomerNumber()
      const orderNumber = await reserveNextOrderNumber()

      await db.sales.add({
        productId,
        variantId,
        itemName: name,
        category: productCategory,
        variant: variantLabel,
        qty: Math.max(1, Math.round(line.qty.value)),
        soldFor: primaryAmount,
        costAtSale: 0,
        currency: primaryCurrency,
        secondaryAmount: hasSecondary ? line.lrdAmount.value : undefined,
        secondaryCurrency: hasSecondary ? 'LRD' : undefined,
        timestamp: timestampBase,
        customerNumber,
        orderNumber,
        location: 'myShop',
        tbs: false,
        pickedUp: true,
      })

      const fresh = await db.variants.get(variantId)
      if (fresh) {
        await db.variants.update(variantId, {
          stockMyShop: Math.max(0, fresh.stockMyShop - Math.max(1, Math.round(line.qty.value))),
          updatedAt: Date.now(),
        })
      }

      committed++
    }

    if (draft.totals.handCashLrd.value || draft.totals.handCashUsd.value || draft.totals.outboundLrd.value || draft.totals.outboundUsd.value) {
      await db.drawerCounts.add({
        timestamp: timestampBase,
        usdActual: draft.totals.handCashUsd.value,
        lrdActual: draft.totals.handCashLrd.value,
        outboundUsd: draft.totals.outboundUsd.value,
        outboundLrd: draft.totals.outboundLrd.value,
        note: 'Imported from ledger scan',
      })
    }
  })

  return committed
}

export function LedgerScanView({ onClose }: { onClose: () => void }) {
  const [stage, setStage] = useState<Stage>('upload')
  const [images, setImages] = useState<PageImage[]>([])
  const [draft, setDraft] = useState<DaybookDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [progressLabel, setProgressLabel] = useState('Reading image…')

  // Processes one snapshot and merges its lines into the same continuous
  // review feed (keyed by pageIndex so bounding-box highlight sync can find
  // the right source photo later), instead of starting a fresh draft.
  async function handleFile(file: File) {
    setError(null)
    const pageIndex = images.length
    const url = URL.createObjectURL(file)
    setStage('processing')
    try {
      const dims = await getImageDimensions(url)
      setProgressLabel(images.length > 0 ? `Scanning page ${pageIndex + 1}…` : 'Scanning handwriting…')
      const lines = await recognizeLedgerImage(file)
      const parsed = parseLedgerDraft(lines, dims.width, pageIndex)
      const resolvedLines = await applyAliasesToDraftLines(parsed.lines)

      setImages((prev) => [...prev, { url, width: dims.width, height: dims.height }])
      setDraft((prev) =>
        prev
          ? { pageDate: prev.pageDate ?? parsed.pageDate, lines: [...prev.lines, ...resolvedLines], totals: mergeTotals(prev.totals, parsed.totals) }
          : { pageDate: parsed.pageDate, lines: resolvedLines, totals: parsed.totals },
      )
      setStage('review')
    } catch (err) {
      console.error('Ledger scan failed', err)
      setError('Could not read this image. Try a clearer, well-lit photo of the ledger page.')
      setStage(images.length > 0 ? 'review' : 'upload')
    }
  }

  async function handleApprove() {
    if (!draft) return
    setApproving(true)
    try {
      await pushDraftToLedger(draft)
      onClose()
    } catch (err) {
      console.error('Failed to push ledger draft', err)
      setError('Could not save these entries. Please try again.')
    } finally {
      setApproving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-slate-900">
      {stage !== 'verify' && <Header title="Ledger Scan Correction" onBack={onClose} />}

      {stage === 'upload' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-sm text-slate-500">
            Take or choose a clear, well-lit photo of a physical ledger page. Recognition happens fully on this
            device — nothing is uploaded anywhere.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <label className="cursor-pointer rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white">
            Upload Ledger Image
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
              }}
            />
          </label>
        </div>
      )}

      {stage === 'processing' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
          <p className="text-sm text-slate-500">{progressLabel}</p>
        </div>
      )}

      {stage === 'review' && draft && images.length > 0 && (
        <DaybookDraftReview
          draft={draft}
          setDraft={setDraft}
          images={images}
          onAddPage={images.length < MAX_PAGES ? handleFile : undefined}
          pagesUsed={images.length}
          maxPages={MAX_PAGES}
          onVerify={() => setStage('verify')}
          onApprove={handleApprove}
          onDiscard={onClose}
          approving={approving}
          error={error}
        />
      )}

      {stage === 'verify' && draft && images.length > 0 && (
        <FocusedScanVerification
          draft={draft}
          images={images}
          onDone={(updated) => {
            setDraft(updated)
            setStage('review')
          }}
        />
      )}
    </div>
  )
}
