import { createWorker, type Worker } from 'tesseract.js'

// Confidence below this threshold (out of 100), or a field we couldn't find
// at all, gets flagged for the Focused Scan Verification wizard.
export const CONFIDENCE_THRESHOLD = 75

export interface Bbox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrWord {
  text: string
  confidence: number
  bbox: Bbox
}

export interface OcrLine {
  text: string
  confidence: number
  bbox: Bbox
  words: OcrWord[]
}

export interface DraftField<T> {
  value: T
  confidence: number
  verified: boolean
  bbox: Bbox | null // the specific word(s) this field came from, for zoom-to-crop; null falls back to the whole line
}

function field<T>(value: T, confidence: number, bbox: Bbox | null, verified = confidence >= CONFIDENCE_THRESHOLD): DraftField<T> {
  return { value, confidence, verified, bbox }
}

function unionBbox(words: { bbox: Bbox }[]): Bbox | null {
  if (words.length === 0) return null
  return {
    x0: Math.min(...words.map((w) => w.bbox.x0)),
    y0: Math.min(...words.map((w) => w.bbox.y0)),
    x1: Math.max(...words.map((w) => w.bbox.x1)),
    y1: Math.max(...words.map((w) => w.bbox.y1)),
  }
}

export interface DraftLine {
  key: string
  qty: DraftField<number>
  description: DraftField<string>
  lrdAmount: DraftField<number>
  usdAmount: DraftField<number>
  bbox: Bbox
}

export interface DraftTotals {
  totalLrd: DraftField<number>
  totalUsd: DraftField<number>
  outboundLrd: DraftField<number>
  outboundUsd: DraftField<number>
  handCashLrd: DraftField<number>
  handCashUsd: DraftField<number>
}

export interface DaybookDraft {
  pageDate: string | null // yyyy-MM-dd, parsed from the ledger header, or null if unreadable
  lines: DraftLine[]
  totals: DraftTotals
}

let workerPromise: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const base = import.meta.env.BASE_URL
    // Absolute URLs, and workerBlobURL disabled: Tesseract's default wraps
    // the worker script in a Blob, whose own base URL isn't our origin, so
    // any relative corePath/langPath silently fails to resolve from inside
    // it -- resulting in the WASM core falling back to its own hardcoded
    // default path and failing to find the language data.
    workerPromise = createWorker('eng', 1, {
      workerPath: new URL(`${base}tesseract/worker.min.js`, window.location.href).href,
      corePath: new URL(`${base}tesseract/core/tesseract-core-lstm.wasm.js`, window.location.href).href,
      langPath: new URL(`${base}tesseract/lang-data`, window.location.href).href,
      workerBlobURL: false,
      // Served uncompressed on purpose: static hosts (including the vite
      // preview server and GitHub Pages) can auto-set Content-Encoding:
      // gzip for .gz-named files, which silently double-decompresses
      // against Tesseract's own manual gunzip and corrupts the data.
      gzip: false,
    })
  }
  return workerPromise
}

// Runs OCR on the captured ledger photo and returns text grouped into lines
// (Tesseract already clusters words into lines/paragraphs/blocks for us),
// sorted top-to-bottom the way a physical page reads.
export async function recognizeLedgerImage(image: Blob): Promise<OcrLine[]> {
  const worker = await getWorker()
  // `blocks` (word/line bbox + confidence data) isn't populated unless
  // explicitly requested -- without this, data.blocks is empty and every
  // line/word/bbox we rely on for parsing and zoom-to-crop is missing.
  const { data } = await worker.recognize(image, {}, { blocks: true })
  const lines: OcrLine[] = []
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const text = line.text.trim()
        if (!text) continue
        lines.push({
          text,
          confidence: line.confidence,
          bbox: line.bbox,
          words: line.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })),
        })
      }
    }
  }
  lines.sort((a, b) => a.bbox.y0 - b.bbox.y0)
  return lines
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, '').replace(/\.(?=.*\.)/g, '') // keep only the last dot if several
  if (!cleaned || cleaned === '.') return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

function isAmountWord(text: string): boolean {
  return /\d/.test(text) && /^[\$L]?[\d.,-]+-?$/.test(text.replace(/\s/g, ''))
}

function isQtyWord(text: string): boolean {
  return /^\(?\d{1,2}\)?\.?$/.test(text.trim())
}

const FINANCIAL_KEYWORDS = {
  total: /\btotal\b/i,
  outbound: /\bvishal\b|\bsent\b|\bdraw(n)?\b|\bdeduct/i,
  handCash: /\bhand\s*cash\b|\bcash\s*(in\s*)?hand\b|\bclosing\b/i,
}

// Heuristic parser matching this shop's specific handwritten layout: a
// leading circled/parenthesized quantity, a continuous item description,
// then trailing right-aligned numbers split into LRD (left column) and USD
// (right column) by horizontal position. Anything we can't confidently
// place is flagged (low confidence / unverified) for the correction wizard
// rather than silently guessed.
export function parseLedgerDraft(lines: OcrLine[], imageWidth: number): DaybookDraft {
  const draftLines: DraftLine[] = []
  const totals: DraftTotals = {
    totalLrd: field(0, 0, null, false),
    totalUsd: field(0, 0, null, false),
    outboundLrd: field(0, 100, null, true),
    outboundUsd: field(0, 100, null, true),
    handCashLrd: field(0, 0, null, false),
    handCashUsd: field(0, 0, null, false),
  }

  let pageDate: string | null = null
  let inFinancialSection = false
  let lineIdx = 0

  for (const line of lines) {
    if (!pageDate) {
      const m = line.text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/)
      if (m) {
        const [, d, mo, y] = m
        const year = y.length === 2 ? `20${y}` : y
        pageDate = `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
        // A line that's essentially just the date header (nothing else
        // meaningful on it) isn't a line item -- skip it entirely.
        const remainder = line.text.replace(m[0], '').trim()
        if (remainder.length <= 2) continue
      }
    }

    const isTotalRow = FINANCIAL_KEYWORDS.total.test(line.text)
    const isOutboundRow = FINANCIAL_KEYWORDS.outbound.test(line.text)
    const isHandCashRow = FINANCIAL_KEYWORDS.handCash.test(line.text)

    if (isTotalRow || isOutboundRow || isHandCashRow) inFinancialSection = true

    if (inFinancialSection) {
      const amountWords = line.words.filter((w) => isAmountWord(w.text))
      const [left, right] = splitColumns(amountWords, imageWidth)
      if (isTotalRow) {
        if (left) totals.totalLrd = field(parseAmount(left.text) ?? 0, left.confidence, left.bbox)
        if (right) totals.totalUsd = field(parseAmount(right.text) ?? 0, right.confidence, right.bbox)
      } else if (isOutboundRow) {
        if (left) totals.outboundLrd = field(parseAmount(left.text) ?? 0, left.confidence, left.bbox)
        if (right) totals.outboundUsd = field(parseAmount(right.text) ?? 0, right.confidence, right.bbox)
      } else if (isHandCashRow) {
        if (left) totals.handCashLrd = field(parseAmount(left.text) ?? 0, left.confidence, left.bbox)
        if (right) totals.handCashUsd = field(parseAmount(right.text) ?? 0, right.confidence, right.bbox)
      }
      continue
    }

    // Line-item row: leading qty, middle description, trailing amount column(s).
    const words = [...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0)
    if (words.length === 0) continue

    let qtyWord: OcrWord | null = null
    let rest = words
    if (words.length > 0 && isQtyWord(words[0].text)) {
      qtyWord = words[0]
      rest = words.slice(1)
    }

    const amountWords = rest.filter((w) => isAmountWord(w.text))
    const descriptionWords = rest.filter((w) => !isAmountWord(w.text))
    if (descriptionWords.length === 0 && amountWords.length === 0) continue // blank/noise row

    const [left, right] = splitColumns(amountWords, imageWidth)

    const qty = qtyWord
      ? field(parseAmount(qtyWord.text) ?? 1, qtyWord.confidence, qtyWord.bbox)
      : field(1, 0, line.bbox, false)
    const description = descriptionWords.length
      ? field(
          descriptionWords.map((w) => w.text).join(' '),
          Math.min(...descriptionWords.map((w) => w.confidence)),
          unionBbox(descriptionWords),
        )
      : field('', 0, line.bbox, false)
    const lrdAmount = left ? field(parseAmount(left.text) ?? 0, left.confidence, left.bbox) : field(0, 100, null, true)
    const usdAmount = right ? field(parseAmount(right.text) ?? 0, right.confidence, right.bbox) : field(0, 100, null, true)

    draftLines.push({
      key: `draft-line-${lineIdx++}`,
      qty,
      description,
      lrdAmount,
      usdAmount,
      bbox: line.bbox,
    })
  }

  return { pageDate, lines: draftLines, totals }
}

// Splits up to two trailing amount tokens into [LRD, USD] by column
// position -- two tokens means left=LRD, right=USD; a single token is
// classified by how far right it sits on the page (the USD column runs
// along the far-right edge in this ledger's layout).
function splitColumns(amountWords: OcrWord[], imageWidth: number): [OcrWord | null, OcrWord | null] {
  if (amountWords.length === 0) return [null, null]
  if (amountWords.length === 1) {
    const w = amountWords[0]
    const isRightEdge = w.bbox.x0 > imageWidth * 0.82
    return isRightEdge ? [null, w] : [w, null]
  }
  const sorted = [...amountWords].sort((a, b) => a.bbox.x0 - b.bbox.x0)
  return [sorted[0], sorted[sorted.length - 1]]
}

export async function terminateLedgerOcr(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise
    await worker.terminate()
    workerPromise = null
  }
}
