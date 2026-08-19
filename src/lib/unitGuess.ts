// A word in the name wins over the category guess -- so "Zinc Gutter"
// still guesses "Piece" even though the rest of the Zinc line sells by
// the sheet/bundle. Same shape as the counter-ledger reference's own
// guessUnit, just mapped onto this app's UNIT_TYPES vocabulary. Shared by
// Sell (per-cart-line default) and Stock (the "cost -> +markup per X"
// line on each product card).
const NAME_UNIT_HINTS: [RegExp, string][] = [
  [/\b(wire|cable|hose|wallpaper|tape)\b/i, 'Roll'],
  [/\b(gutter|barrow|tire|mirror|fan|lock|switch|socket|bulb|iron|kettle|stove|blender|flask|pump|generator|stabali[sz]er|panel box|breaker)\b/i, 'Piece'],
  [/\b(zinc|sheet|ply|board)\b/i, 'Sheet'],
  [/\b(paint|thinner)\b/i, 'Bucket'],
  [/\b(cement|nail|screw|clip)\b/i, 'Pack'],
  [/\b(tile|tiles)\b/i, 'Carton'],
  [/\b(mattress|chair|table|freezer|refrigerator|tv|speaker)\b/i, 'Piece'],
]

export function guessUnit(name: string, category: string): string {
  for (const [re, u] of NAME_UNIT_HINTS) if (re.test(name)) return u
  if (/roofing/i.test(category)) return 'Sheet'
  if (/wire/i.test(category)) return 'Roll'
  return 'Piece'
}
