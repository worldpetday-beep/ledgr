import { db, VOICE_WORKER_URL_KEY, type Product, type Variant } from '../db'
import { sellUnitsOf } from './sellUnits'

export interface ParsedLine {
  productId: number
  variantId: number
  qty: number
  priceUsd: number
  priceLrd: number
  paidUsd: number
  paidLrd: number
  tbs: boolean
  rawPhrase: string
}

export interface NeedsInputItem {
  rawPhrase: string
  reason: string
}

export interface ParsedVoiceEntry {
  lines: ParsedLine[]
  needsInput: NeedsInputItem[]
  drawer: { usd: number; lrd: number } | null
  momo: { usd: number; lrd: number } | null
}

// One row per sell-unit, matching how Sell.tsx's own catalog is built --
// Claude gets exactly the same product/variant/unit granularity the app
// itself works with, so a resolved productId+variantId always maps onto
// something the review screen already knows how to add to a cart.
export async function buildCatalogSnapshot() {
  const [products, variants] = await Promise.all([db.products.toArray(), db.variants.toArray()])
  const productById = new Map(products.map((p) => [p.id!, p]))
  const rows: { productId: number; variantId: number; name: string; unit: string; currency: string; cost: number; price: number; factor: number }[] = []
  for (const v of variants) {
    const p = productById.get(v.productId)
    if (!p || p.archived) continue
    for (const unit of sellUnitsOf(v, p.name, p.category)) {
      rows.push({
        productId: p.id!,
        variantId: v.id!,
        name: v.label === 'Standard' ? p.name : `${p.name} — ${v.label}`,
        unit: unit.unit,
        currency: unit.currency,
        cost: Math.round(v.costPrice * unit.factor * 100) / 100,
        price: unit.price,
        factor: unit.factor,
      })
    }
  }
  return { rows, productById, variantById: new Map(variants.map((v) => [v.id!, v])) }
}

export async function loadRecentCorrections(limit = 200) {
  const all = await db.voiceCorrections.toArray()
  return all
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, limit)
    .map((c) => ({ phrase: c.phrase, productId: c.productId, variantId: c.variantId }))
}

export async function saveCorrection(phrase: string, productId: number, variantId: number) {
  const normalized = phrase.trim().toLowerCase()
  if (!normalized) return
  const existing = await db.voiceCorrections.where('phrase').equals(normalized).first()
  if (existing) {
    await db.voiceCorrections.update(existing.id!, { productId, variantId, count: existing.count + 1, lastUsed: Date.now() })
  } else {
    await db.voiceCorrections.add({ phrase: normalized, productId, variantId, count: 1, lastUsed: Date.now() })
  }
}

export class VoiceEntryError extends Error {}

// The one call to the outside world in this whole app -- everything else
// runs offline. If this fails for any reason (no Worker URL configured,
// network down, the Worker/Claude erroring out), the caller falls back to
// plain manual entry; nothing here is allowed to leave the owner stuck.
export async function parseVoiceTranscript(transcript: string): Promise<ParsedVoiceEntry> {
  const urlRow = await db.settings.get(VOICE_WORKER_URL_KEY)
  const workerUrl = urlRow?.value?.trim()
  if (!workerUrl) {
    throw new VoiceEntryError('No voice-entry server configured yet — set it in Numbers → Setup → Voice entry.')
  }

  const { rows } = await buildCatalogSnapshot()
  const corrections = await loadRecentCorrections()

  let res: Response
  try {
    res = await fetch(`${workerUrl.replace(/\/$/, '')}/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript, catalog: rows, corrections }),
    })
  } catch {
    throw new VoiceEntryError('Could not reach the voice-entry server — check your connection and try again.')
  }

  if (!res.ok) {
    throw new VoiceEntryError(`Voice-entry server error (${res.status}). Try again, or enter this sale by hand.`)
  }

  const data = (await res.json()) as Partial<ParsedVoiceEntry>
  return {
    lines: Array.isArray(data.lines) ? data.lines : [],
    needsInput: Array.isArray(data.needsInput) ? data.needsInput : [],
    drawer: data.drawer ?? null,
    momo: data.momo ?? null,
  }
}

export function findCatalogRow(
  rows: Awaited<ReturnType<typeof buildCatalogSnapshot>>['rows'],
  productId: number,
  variantId: number,
) {
  return rows.find((r) => r.productId === productId && r.variantId === variantId)
}

export type { Product, Variant }
