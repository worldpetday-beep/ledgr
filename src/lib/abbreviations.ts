import { db, type AbbreviationRule } from '../db'
import type { DraftLine } from './ledgerOcr'

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

// Tokens short enough, and plain enough, to plausibly be shorthand rather
// than a genuine short item word ("nail", "wire") -- used only to decide
// whether an *unmatched* token deserves the "unresolved abbreviation"
// warning treatment, not to reject anything outright.
function looksLikeAbbreviation(token: string): boolean {
  return /^[a-z]{2,5}\.?$/i.test(token) && !/^(the|and|for|red|blue|iron|wire|nail|roll|pipe|door|lock|wood|pack)$/i.test(token)
}

export interface AliasResolution {
  expanded: string
  matched: boolean // false => at least one token looks like shorthand with no known rule; render the warning + picker
}

// Cross-references raw OCR text for the Item Description column against the
// alias map: a whole-phrase match takes priority (covers multi-word
// shorthand like the "8\" st. Spec. Double mat" seed rule), otherwise each
// individual token is replaced if it matches a rule on its own.
export function resolveAlias(raw: string, rules: AbbreviationRule[]): AliasResolution {
  const text = raw.trim()
  if (!text) return { expanded: text, matched: false }

  const normalizedWhole = normalize(text)
  const wholeMatch = rules.find((r) => normalize(r.pattern) === normalizedWhole)
  if (wholeMatch) return { expanded: wholeMatch.expansion, matched: true }

  const tokens = text.split(/\s+/)
  let anyReplaced = false
  let anyUnresolved = false
  const expandedTokens = tokens.map((token) => {
    const bare = token.replace(/[.,]+$/, '')
    const rule = rules.find((r) => normalize(r.pattern) === normalize(bare))
    if (rule) {
      anyReplaced = true
      return rule.expansion
    }
    if (looksLikeAbbreviation(bare)) anyUnresolved = true
    return token
  })

  return {
    expanded: expandedTokens.join(' '),
    matched: !anyUnresolved || anyReplaced ? !anyUnresolved : false,
  }
}

export async function loadAbbreviationRules(): Promise<AbbreviationRule[]> {
  return db.abbreviations.toArray()
}

// Intercepts the raw Column 2 text for one parsed line: expands it via the
// alias map when a rule matches, and flags it (aliasResolved: false) when a
// token still looks like unrecognized shorthand, so the review UI can show
// the warning highlight + inline catalog picker.
export function applyAliasesToLine(line: DraftLine, rules: AbbreviationRule[]): DraftLine {
  const { expanded, matched } = resolveAlias(line.description.value, rules)
  if (!matched) return { ...line, aliasResolved: false }
  if (expanded === line.description.value) return { ...line, aliasResolved: true }
  return { ...line, description: { ...line.description, value: expanded }, aliasResolved: true }
}

export async function applyAliasesToDraftLines(lines: DraftLine[]): Promise<DraftLine[]> {
  const rules = await loadAbbreviationRules()
  return lines.map((l) => applyAliasesToLine(l, rules))
}

// Called once the user manually picks a catalog match for an unresolved
// description in the review UI -- the exact raw text becomes a new pattern
// so the same shorthand auto-resolves on future scans without asking again.
export async function addAbbreviationRule(pattern: string, expansion: string): Promise<void> {
  const cleanPattern = pattern.trim()
  const cleanExpansion = expansion.trim()
  if (!cleanPattern || !cleanExpansion) return
  const existing = await db.abbreviations.where('pattern').equalsIgnoreCase(cleanPattern).first()
  if (existing) {
    if (existing.expansion !== cleanExpansion) await db.abbreviations.update(existing.id!, { expansion: cleanExpansion })
    return
  }
  await db.abbreviations.add({ pattern: cleanPattern, expansion: cleanExpansion, createdAt: Date.now() })
}
