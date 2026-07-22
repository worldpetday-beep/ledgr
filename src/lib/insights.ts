import { db, type Currency, type Sale } from '../db'
import { dateKeyMonrovia, formatDateMonrovia, money, startOfDay, endOfDay } from './format'

function customerLabel(sale: Sale): string {
  return sale.customerName || `Customer ${String(sale.customerNumber).padStart(3, '0')}`
}

function daysAgo(n: number): number {
  return Date.now() - n * 24 * 60 * 60 * 1000
}

const STOPWORDS = new Set([
  'which', 'who', 'what', 'is', 'my', 'the', 'a', 'an', 'in', 'of', 'did', 'has', 'have',
  'bought', 'buy', 'buys', 'brought', 'purchase', 'purchased', 'purchases', 'customer',
  'customers', 'last', 'days', 'day', 'ago', 'sold', 'sale', 'sales', 'total', 'revenue',
  'top', 'best', 'highest', 'for', 'me', 'tell', 'show', 'give', 'how', 'many', 'much', 'got',
])

const UNIT_WORDS = [
  'piece', 'pieces', 'carton', 'cartons', 'sheet', 'sheets', 'bundle', 'bundles',
  'yard', 'yards', 'gallon', 'gallons', 'bucket', 'buckets', 'pack', 'packs',
]

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w) && !UNIT_WORDS.includes(w) && Number.isNaN(Number(w)))
}

export async function answerInsightQuery(query: string): Promise<string> {
  const q = query.toLowerCase().trim()
  if (!q) {
    return 'Ask me something like "what\'s my highest revenue day" or "which customer bought zinc in the last 15 days".'
  }

  if (/\b(which|who)\b/.test(q) && /(bought|purchase|brought|got)/.test(q)) {
    return answerCustomerLookup(q)
  }

  if (/(day|date)/.test(q) && /(top|best|highest)/.test(q)) {
    return answerTopDay()
  }

  if (/customer/.test(q) && /(top|best|highest)/.test(q)) {
    return answerTopCustomer()
  }

  if (/(total|revenue|sales)/.test(q)) {
    return answerTotalsForPeriod(q)
  }

  return 'I can currently answer questions about: your highest revenue day, your top customer, total sales for a period (today/this week/this month), or which customers bought a specific item recently. Try rephrasing along those lines.'
}

async function answerTopDay(): Promise<string> {
  const sales = await db.sales.toArray()
  if (sales.length === 0) return 'No sales recorded yet.'

  const byDay = new Map<string, Partial<Record<Currency, number>>>()
  for (const s of sales) {
    const key = dateKeyMonrovia(s.timestamp)
    const entry = byDay.get(key) ?? {}
    entry[s.currency] = (entry[s.currency] ?? 0) + s.soldFor
    byDay.set(key, entry)
  }

  let bestUsd: { key: string; total: number } | null = null
  let bestLrd: { key: string; total: number } | null = null
  for (const [key, totals] of byDay) {
    if (totals.USD && (!bestUsd || totals.USD > bestUsd.total)) bestUsd = { key, total: totals.USD }
    if (totals.LRD && (!bestLrd || totals.LRD > bestLrd.total)) bestLrd = { key, total: totals.LRD }
  }

  const parts: string[] = []
  if (bestUsd) parts.push(`in USD was ${formatDateMonrovia(new Date(bestUsd.key).getTime())} with ${money(bestUsd.total, 'USD')}`)
  if (bestLrd) parts.push(`in LRD was ${formatDateMonrovia(new Date(bestLrd.key).getTime())} with ${money(bestLrd.total, 'LRD')}`)
  if (parts.length === 0) return 'No sales recorded yet.'
  return `Your highest revenue day ${parts.join(', and ')}.`
}

async function answerTopCustomer(): Promise<string> {
  const sales = await db.sales.toArray()
  if (sales.length === 0) return 'No sales recorded yet.'

  const byCustomer = new Map<number, { label: string; totals: Partial<Record<Currency, number>>; orders: Set<number> }>()
  for (const s of sales) {
    const entry = byCustomer.get(s.customerNumber) ?? { label: customerLabel(s), totals: {}, orders: new Set<number>() }
    entry.totals[s.currency] = (entry.totals[s.currency] ?? 0) + s.soldFor
    entry.orders.add(s.orderNumber)
    if (s.customerName) entry.label = s.customerName
    byCustomer.set(s.customerNumber, entry)
  }

  let bestUsd: { label: string; total: number; orders: number } | null = null
  let bestLrd: { label: string; total: number; orders: number } | null = null
  for (const entry of byCustomer.values()) {
    if (entry.totals.USD && (!bestUsd || entry.totals.USD > bestUsd.total)) {
      bestUsd = { label: entry.label, total: entry.totals.USD, orders: entry.orders.size }
    }
    if (entry.totals.LRD && (!bestLrd || entry.totals.LRD > bestLrd.total)) {
      bestLrd = { label: entry.label, total: entry.totals.LRD, orders: entry.orders.size }
    }
  }

  const parts: string[] = []
  if (bestUsd) parts.push(`In USD, ${bestUsd.label} leads with ${money(bestUsd.total, 'USD')} across ${bestUsd.orders} order${bestUsd.orders === 1 ? '' : 's'}.`)
  if (bestLrd) parts.push(`In LRD, ${bestLrd.label} leads with ${money(bestLrd.total, 'LRD')} across ${bestLrd.orders} order${bestLrd.orders === 1 ? '' : 's'}.`)
  if (parts.length === 0) return 'No sales recorded yet.'
  return parts.join(' ')
}

async function answerTotalsForPeriod(q: string): Promise<string> {
  const now = Date.now()
  let from = 0
  let to = now
  let label = 'all time'

  if (/today/.test(q)) {
    from = startOfDay(now)
    label = 'today'
  } else if (/yesterday/.test(q)) {
    from = startOfDay(now - 86400000)
    to = endOfDay(now - 86400000)
    label = 'yesterday'
  } else if (/week/.test(q)) {
    from = now - 7 * 86400000
    label = 'the last 7 days'
  } else if (/month/.test(q)) {
    from = now - 30 * 86400000
    label = 'the last 30 days'
  }

  const sales = await db.sales.where('timestamp').between(from, to, true, true).toArray()
  const totals: Partial<Record<Currency, number>> = {}
  for (const s of sales) totals[s.currency] = (totals[s.currency] ?? 0) + s.soldFor
  const parts = (Object.entries(totals) as [Currency, number][]).map(([c, amt]) => money(amt, c))
  if (parts.length === 0) return `No sales recorded for ${label}.`
  return `Total sales for ${label}: ${parts.join(' + ')} across ${sales.length} line item${sales.length === 1 ? '' : 's'}.`
}

async function answerCustomerLookup(q: string): Promise<string> {
  let daysBack = 30
  let cleaned = q

  const dayMatch = q.match(/last\s+(\d+)\s*days?/)
  if (dayMatch) {
    daysBack = parseInt(dayMatch[1], 10)
    cleaned = cleaned.replace(dayMatch[0], ' ')
  }

  let qtyThreshold: number | null = null
  const qtyMatch = cleaned.match(
    /(\d+)\s*(piece|pieces|carton|cartons|sheet|sheets|bundle|bundles|yard|yards|gallon|gallons|bucket|buckets|pack|packs)?/,
  )
  if (qtyMatch) qtyThreshold = parseInt(qtyMatch[1], 10)

  const keywords = extractKeywords(cleaned)
  if (keywords.length === 0) {
    return 'Tell me what item you\'re asking about, e.g. "which customer bought zinc in the last 15 days".'
  }

  const from = daysAgo(daysBack)
  const sales = await db.sales.where('timestamp').aboveOrEqual(from).toArray()
  const matching = sales.filter((s) => {
    const haystack = `${s.itemName} ${s.variant ?? ''} ${s.unitType ?? ''}`.toLowerCase()
    return keywords.some((k) => haystack.includes(k))
  })

  if (matching.length === 0) {
    return `No sales matching "${keywords.join(' ')}" in the last ${daysBack} days.`
  }

  const byCustomer = new Map<number, { label: string; qty: number; orders: Set<number> }>()
  for (const s of matching) {
    const entry = byCustomer.get(s.customerNumber) ?? { label: customerLabel(s), qty: 0, orders: new Set<number>() }
    entry.qty += s.qty
    entry.orders.add(s.orderNumber)
    if (s.customerName) entry.label = s.customerName
    byCustomer.set(s.customerNumber, entry)
  }

  let results = Array.from(byCustomer.values())
  if (qtyThreshold != null) results = results.filter((r) => r.qty >= qtyThreshold!)
  results.sort((a, b) => b.qty - a.qty)

  if (results.length === 0) {
    return `No customer bought ${qtyThreshold ?? ''} or more matching "${keywords.join(' ')}" in the last ${daysBack} days.`
  }

  const lines = results
    .slice(0, 5)
    .map((r) => `${r.label} — ${r.qty} unit${r.qty === 1 ? '' : 's'} across ${r.orders.size} order${r.orders.size === 1 ? '' : 's'}`)
  return `Matching "${keywords.join(' ')}" in the last ${daysBack} days:\n${lines.join('\n')}`
}
