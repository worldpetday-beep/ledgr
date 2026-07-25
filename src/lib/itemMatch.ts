// Treats "inches", "inch", "in", and the double-quote symbol as the same
// search token (all collapsed to a single canonical `in` marker right after
// the number they qualify), so a search for "6 inches mattress" surfaces the
// exact same catalog rows as "6\" mattress" and vice versa.
const DIMENSION_WORD_RE = /(\d+)\s*(?:"|inches\b|inch\b|in\b)/gi

export function normalizeItemSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(DIMENSION_WORD_RE, '$1in')
    .replace(/\s+/g, ' ')
    .trim()
}

export function itemSearchMatches(candidateLabel: string, query: string): boolean {
  const q = normalizeItemSearchText(query)
  if (!q) return true
  return normalizeItemSearchText(candidateLabel).includes(q)
}

// Word-order-invariant identity key for duplicate detection -- "4 inch
// nail" and "nail 4 inch" reduce to the same key, so re-typed items that
// only differ in token order surface as the same underlying product
// regardless of which order the words were written in.
export function tokenSortKey(name: string): string {
  return normalizeItemSearchText(name)
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ')
}
