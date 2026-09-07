// Voice-to-Sale parsing proxy. Holds the Anthropic API key server-side (a
// Worker secret, never shipped to the client) and turns one spoken
// transcript + the current catalog into strict structured JSON that the
// Ledgr app's review screen can show for confirmation. It never writes
// anything itself -- Ledgr always requires a manual "Confirm and record"
// tap before anything is saved.

export interface Env {
  ANTHROPIC_API_KEY: string
  // Comma-separated list of allowed origins, e.g.
  // "https://worldpetday-beep.github.io". Set via `wrangler secret put`
  // or a plain [vars] entry in wrangler.toml -- it's not sensitive, just
  // config, so a plain var is fine.
  ALLOWED_ORIGINS?: string
}

interface CatalogItem {
  productId: number
  variantId: number
  name: string // full display label, e.g. "Zinc — 14G"
  unit: string
  currency: 'USD' | 'LRD'
  cost: number
  price: number
}

interface Correction {
  phrase: string
  productId: number
  variantId: number
}

interface ParseRequest {
  transcript: string
  catalog: CatalogItem[]
  corrections: Correction[]
}

const MODEL = 'claude-haiku-4-5'

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0] ?? '*'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

// The parsing rules from the feature brief, plus the currency rule the
// owner actually confirmed: he doesn't follow a fixed magnitude cutoff, he
// just says it however comes naturally and expects it to be understood --
// so currency is resolved from context (catalog reference price/currency
// for that exact item, explicit words like "dollars"/"Liberian"/"L"), with
// magnitude only as a last-resort tiebreaker, and genuine ambiguity goes
// to needsInput instead of a guess.
const SYSTEM_PROMPT = `You are a parser for a Liberian hardware store's spoken sales ledger. The owner reads out a day's sales, or a mix of sales and cash/till figures, in his own shorthand -- not a fixed script. Turn the transcript into structured JSON, matching spoken items against the product catalog you're given.

CURRENCY: There is no fixed number-size rule for USD vs LRD -- resolve it from context, in this priority order:
1. An explicit word in the phrase itself ("dollars", "USD", "Liberian", "LD", "L").
2. The catalog reference price/currency for whichever product you matched -- if the spoken number is close to that item's known price in one currency, prefer that currency.
3. Only as a last resort, typical magnitude (LRD amounts are usually much larger numbers than USD amounts for the same kind of item).
If you genuinely cannot tell, do not guess -- put that line in needsInput with the raw phrase and a note that the currency is ambiguous.

MATCHING: Match spoken item names to the catalog loosely (shorthand, partial names, misheard words are expected). If a "known shorthand" list is provided, treat those as confirmed mappings the owner has already corrected before -- prefer them over a fresh guess for the same phrase. If nothing in the catalog is a confident match, do NOT invent a product -- put it in needsInput with the raw phrase instead.

OTHER RULES:
- "TBS" anywhere in a line means: not yet delivered, don't deduct stock, mark tbs: true.
- A spoken partial/installment payment ("paid 25 as installment", "gave 25 for now") sets paidUsd/paidLrd lower than the line's price -- it is a partial payment on that line, not the full price.
- A spoken drawer/till cash figure ("today's till was 1990 dollars and 31,700 Liberian") is NOT a sale line -- put it in the separate "drawer" field, never in "lines".
- A spoken Mobile Money (MoMo) figure is its own separate field ("momo"), never mixed into the drawer cash figures or a sale line.
- Never invent a product, price, or total that was not actually in the transcript or the catalog.

Respond with ONLY a single JSON object, no prose, no markdown fences, matching exactly this shape:
{
  "lines": [
    { "productId": number, "variantId": number, "qty": number, "priceUsd": number, "priceLrd": number, "paidUsd": number, "paidLrd": number, "tbs": boolean, "rawPhrase": string }
  ],
  "needsInput": [
    { "rawPhrase": string, "reason": string }
  ],
  "drawer": { "usd": number, "lrd": number } | null,
  "momo": { "usd": number, "lrd": number } | null
}
Every number is a plain number, never a string. priceUsd/priceLrd/paidUsd/paidLrd are 0 when not applicable to that line's currency (a line is normally priced in ONE currency, so the other of the pair is 0 unless it was genuinely a split payment).`

async function handleParse(req: Request, env: Env): Promise<Response> {
  let body: ParseRequest
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.transcript?.trim()) {
    return Response.json({ error: 'transcript is required' }, { status: 400 })
  }

  const userContent = [
    `Product catalog (productId, variantId, name, unit, currency, cost, price):`,
    JSON.stringify(body.catalog ?? []),
    body.corrections?.length ? `\nKnown shorthand (phrases the owner has confirmed before):\n${JSON.stringify(body.corrections)}` : '',
    `\nTranscript:\n"""${body.transcript}"""`,
  ].join('\n')

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  })

  if (!anthropicRes.ok) {
    const text = await anthropicRes.text()
    return Response.json({ error: `Claude API error: ${anthropicRes.status}`, detail: text }, { status: 502 })
  }

  const data = await anthropicRes.json<{ content: { type: string; text?: string }[] }>()
  const textBlock = data.content.find((b) => b.type === 'text')
  if (!textBlock?.text) {
    return Response.json({ error: 'No text in Claude response' }, { status: 502 })
  }

  let parsed: unknown
  try {
    // Claude is instructed to return raw JSON only, but strip markdown
    // fences defensively in case a stray ``` sneaks in.
    const cleaned = textBlock.text.trim().replace(/^```(?:json)?\n?/, '').replace(/```$/, '')
    parsed = JSON.parse(cleaned)
  } catch {
    return Response.json({ error: 'Could not parse JSON from Claude response', raw: textBlock.text }, { status: 502 })
  }

  return Response.json(parsed)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin')
    const headers = corsHeaders(origin, env)

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers })
    }

    const url = new URL(req.url)
    if (url.pathname !== '/parse' || req.method !== 'POST') {
      return new Response('Not found', { status: 404, headers })
    }

    try {
      const res = await handleParse(req, env)
      const merged = new Headers(res.headers)
      for (const [k, v] of Object.entries(headers)) merged.set(k, v)
      return new Response(res.body, { status: res.status, headers: merged })
    } catch (err) {
      return Response.json({ error: 'Unexpected server error', detail: String(err) }, { status: 500, headers })
    }
  },
}
