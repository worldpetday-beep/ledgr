import type { AbbreviationRule, Product, Variant } from '../db'
import { resolveAlias } from './abbreviations'

// Trailing "/tag" source-switch flags recognized on an order line, mapped
// to the human-readable note stored alongside the sale. An unrecognized
// tag still gets flagged (falls back to a generic "Sourced from X" note)
// rather than silently dropped.
const SOURCE_TAG_NOTES: Record<string, string> = {
  bro: 'Sourced from Brother to fulfill local stock shortfall',
}

export interface ParsedOrderLine {
  qty: number
  unitAbbrev: string
  description: string
  sourceTag: string | null
  sourceNote: string | null
}

// Matches "[Quantity][Unit] [Item Description Alias Phrase] [/SourceTag]",
// e.g. `1pc 8" st. spec. double mat /bro` -> qty 1, unit "pc", description
// resolved through the abbreviation dictionary to "8\" star special double
// mattress", sourceTag "bro" with its mapped note.
const LINE_PATTERN = /^(\d+)\s*([a-zA-Z]+)\.?\s+(.+)$/

// Splits a quick-entry box's raw text into individual order lines on
// top-level commas ("1pc wheel barrow tire, 2 bags cement" -> two lines),
// trimming and dropping anything blank.
export function splitOrderLines(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function parseNaturalLanguageLine(raw: string, rules: AbbreviationRule[]): ParsedOrderLine | null {
  const text = raw.trim()
  if (!text) return null

  let sourceTag: string | null = null
  let rest = text
  const tagMatch = rest.match(/\/(\w+)\s*$/)
  if (tagMatch) {
    sourceTag = tagMatch[1].toLowerCase()
    rest = rest.slice(0, tagMatch.index).trim()
  }

  const m = rest.match(LINE_PATTERN)
  // A leading "[qty][unit]" is optional -- plain "cement" (no count/unit
  // typed) still parses, just defaulting to qty 1 and no unit shortcode,
  // instead of being silently rejected.
  const qty = m ? Number(m[1]) : 1
  const unitAbbrev = m ? m[2].toLowerCase() : ''
  const descriptionRaw = m ? m[3].trim() : rest

  const { expanded } = resolveAlias(descriptionRaw, rules)

  return {
    qty,
    unitAbbrev,
    description: expanded,
    sourceTag,
    sourceNote: sourceTag ? SOURCE_TAG_NOTES[sourceTag] ?? `Sourced from ${sourceTag}` : null,
  }
}

// --- Typo-tolerant product matching ---
// Classic full edit-distance matrix -- fine at these string lengths (item
// names/descriptions, not documents).
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[] = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[n]
}

// 1.0 = identical, 0.0 = nothing in common -- normalized so it's comparable
// across words of different lengths.
function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const dist = levenshtein(a, b)
  return 1 - dist / Math.max(a.length, b.length, 1)
}

// Whole-phrase similarity: each word in the typed description is matched
// against its single best-fitting word in the candidate name (so extra or
// reordered words don't tank the score), then averaged. This is what lets
// "wheel barrow tir" resolve to "Wheel Barrow Tire" -- "tir" scores ~0.75
// against "tire" even though the rest of the phrase matches exactly.
function phraseSimilarity(typed: string, candidate: string): number {
  const typedWords = typed.toLowerCase().split(/\s+/).filter(Boolean)
  const candidateWords = candidate.toLowerCase().split(/\s+/).filter(Boolean)
  if (typedWords.length === 0 || candidateWords.length === 0) return 0
  let total = 0
  for (const tw of typedWords) {
    let best = 0
    for (const cw of candidateWords) best = Math.max(best, wordSimilarity(tw, cw))
    total += best
  }
  return total / typedWords.length
}

export interface ProductMatchCandidate {
  product: Product
  variant: Variant | null
  label: string
  score: number // 0..1
}

export type MatchConfidence = 'linked' | 'suggested' | 'new'

// >= AUTO_LINK: confident enough to link silently (typo-level differences
// only). Below that but >= SUGGEST: close enough to prompt "did you mean
// X?" for confirmation. Below SUGGEST: treated as a genuinely new item.
const AUTO_LINK_THRESHOLD = 0.92
const SUGGEST_THRESHOLD = 0.6

// Scores every non-archived product/variant against a typed (already
// alias-resolved) description and returns the best candidates, highest
// score first.
export function fuzzyMatchProducts(
  description: string,
  products: Product[],
  variantsByProduct: Map<number, Variant[]>,
): ProductMatchCandidate[] {
  const typed = description.trim()
  if (!typed) return []
  const results: ProductMatchCandidate[] = []
  for (const p of products) {
    if (p.archived) continue
    const variants = variantsByProduct.get(p.id!) ?? []
    if (variants.length <= 1) {
      const v = variants[0] ?? null
      const score = phraseSimilarity(typed, p.name)
      results.push({ product: p, variant: v, label: p.name, score })
    } else {
      for (const v of variants) {
        const combined = `${p.name} ${v.label}`
        const score = Math.max(phraseSimilarity(typed, v.label), phraseSimilarity(typed, combined))
        results.push({ product: p, variant: v, label: `${p.name} — ${v.label}`, score })
      }
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 4)
}

export function confidenceOf(candidates: ProductMatchCandidate[]): MatchConfidence {
  const top = candidates[0]
  if (!top) return 'new'
  if (top.score >= AUTO_LINK_THRESHOLD) return 'linked'
  if (top.score >= SUGGEST_THRESHOLD) return 'suggested'
  return 'new'
}
