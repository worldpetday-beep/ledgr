import type { AbbreviationRule } from '../db'
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

export function parseNaturalLanguageLine(raw: string, rules: AbbreviationRule[]): ParsedOrderLine | null {
  const text = raw.trim()
  const m = text.match(LINE_PATTERN)
  if (!m) return null

  const qty = Number(m[1])
  const unitAbbrev = m[2].toLowerCase()
  let rest = m[3].trim()

  let sourceTag: string | null = null
  const tagMatch = rest.match(/\/(\w+)\s*$/)
  if (tagMatch) {
    sourceTag = tagMatch[1].toLowerCase()
    rest = rest.slice(0, tagMatch.index).trim()
  }

  const { expanded } = resolveAlias(rest, rules)

  return {
    qty,
    unitAbbrev,
    description: expanded,
    sourceTag,
    sourceNote: sourceTag ? SOURCE_TAG_NOTES[sourceTag] ?? `Sourced from ${sourceTag}` : null,
  }
}
