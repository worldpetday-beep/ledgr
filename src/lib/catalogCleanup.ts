// A handful of hardware-store "type" words that -- when present alongside
// a size -- mark a variant label as reorderable into the shop's preferred
// reading order: SIZE, then quality/descriptor words, then this type word
// last (e.g. `8" Star Special Double`). Deliberately narrow: only fires
// when BOTH a size token and one of these are found, so anything that
// doesn't fit the pattern (a generator model, a zinc gauge, a tool name)
// is left completely untouched rather than being guessed at.
const TYPE_WORDS = new Set(['double', 'family', 'single', 'queen', 'king', 'twin'])

// Matches "mattress"/"mattrass"/"matress"/"matrress" and other common
// misspellings of the same word -- always dropped as filler since the
// parent product's own name already conveys "this is a mattress".
const GENERIC_FILLER_RE = /^(standard|mat\w*r[ae]ss?\w*)$/i

function normalizeSizeToken(raw: string): string | null {
  const m = raw.match(/^(\d+(?:\.\d+)?)(in|ft|cm|mm|kg|g|lb|oz)?$/i)
  if (!m) return null
  const num = m[1]
  const unit = (m[2] ?? '').toLowerCase()
  if (!unit || unit === 'in') return `${num}"`
  return `${num}${unit}`
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

// Cleans up a variant label without ever touching the variant's id, stock,
// or sale history -- purely a text transform. Two things happen:
// 1. A redundant "SomeProduct — rest" prefix (left over from an earlier
//    Group/Move merge) is dropped -- the parent's own name already shows
//    that, repeating it inside every child row is just noise.
// 2. If (and only if) the remaining text contains both a size and a known
//    type word, it's reordered to SIZE -> quality words -> TYPE and
//    title-cased, e.g. "double 8 inch star special mattress" ->
//    `8" Star Special Double`.
export function reorderVariantLabel(rawLabel: string): string {
  const original = rawLabel.trim()
  if (!original) return rawLabel

  const dashMatch = original.match(/^(.*?)\s+[—-]\s+(.+)$/)
  const text = dashMatch ? dashMatch[2].trim() : original

  // Glue a number to its size unit before splitting on whitespace, so the
  // unit word (e.g. "inch") never leaks out as its own stray word.
  const collapsed = text
    .replace(/(\d+(?:\.\d+)?)\s*"/g, '$1in')
    .replace(/(\d+(?:\.\d+)?)\s*(inches|inch)\b/gi, '$1in')
    .replace(/(\d+(?:\.\d+)?)\s*(feet|ft)\b/gi, '$1ft')

  const words = collapsed.split(/\s+/).filter(Boolean)

  let sizeToken: string | null = null
  let typeWord: string | null = null
  const qualityWords: string[] = []

  for (const w of words) {
    const lower = w.toLowerCase()
    if (!sizeToken) {
      const normalized = normalizeSizeToken(w)
      if (normalized) {
        sizeToken = normalized
        continue
      }
    }
    if (!typeWord && TYPE_WORDS.has(lower)) {
      typeWord = lower
      continue
    }
    if (GENERIC_FILLER_RE.test(lower)) continue
    qualityWords.push(w)
  }

  if (!sizeToken || !typeWord) return text

  return [sizeToken, ...qualityWords.map(titleCase), titleCase(typeWord)].join(' ')
}

// Coarse keyword -> category guesser used when a new merged/moved product
// needs a real category instead of always defaulting to "General". Returns
// null (caller decides the fallback) when nothing matches, rather than
// guessing wrong.
const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/mat\w*r[ae]ss?\w*/i, 'Mattresses'],
  [/generator/i, 'Generators'],
  [/\bzinc\b/i, 'Zinc Sheets'],
  [/\btiles?\b/i, 'Tiles'],
  [/\bfans?\b/i, 'Fans'],
  [/\bpipes?\b|\bhoses?\b/i, 'Plumbing'],
  [/\bnails?\b|\bscrews?\b|\bbolts?\b/i, 'Fasteners'],
  [/\bpaints?\b/i, 'Paint'],
  [/\bcement\b|\bconcrete\b/i, 'Building Materials'],
  [/\bwires?\b|\bcables?\b/i, 'Electrical'],
  [/\bdoors?\b|\bwindows?\b/i, 'Doors & Windows'],
  [/\bmirrors?\b/i, 'Mirrors'],
  [/\bgrinders?\b/i, 'Appliances'],
]

export function guessCategory(name: string): string | null {
  for (const [re, cat] of CATEGORY_KEYWORDS) {
    if (re.test(name)) return cat
  }
  return null
}
