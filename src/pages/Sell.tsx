import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  reserveNextCustomerNumber,
  reserveNextOrderNumber,
  type Currency,
  type FulfillmentLocation,
  type Product,
  type Variant,
} from '../db'
import { ShopifyShell, shopifyInputClass } from '../components/ShopifyShell'
import { BottomSheet, Pill } from '../components/ui'
import { AddProductFastEntryModal } from '../components/AddProductFastEntryModal'
import { PlusIcon, SearchIcon, TrashIcon } from '../components/icons'
import { money, dateKeyMonrovia, formatShortDateMonrovia, variantDisplayLabel } from '../lib/format'
import { withoutVoided } from '../lib/salesLedger'
import { itemSearchMatches } from '../lib/itemMatch'

interface Candidate {
  key: string
  product: Product
  variant: Variant
  label: string
}

interface CartLine {
  key: string
  productId: number
  variantId: number
  label: string
  unit: string
  qty: number
  price: number
  currency: Currency
  cost: number
  tbs: boolean
  stock: number
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// The one screen that has to be fast: search is pinned under the header and
// autofocused, results are compact one-line rows (no grid tiles), a leading
// number in the search box sets quantity ("3 zi" = 3 of whatever zinc row
// you tap), one tap adds and clears the box, and the last result row is
// always "+ Add ..." so a brand-new item never means leaving this screen.
export default function Sell() {
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [settleOpen, setSettleOpen] = useState(false)
  const [addingSeed, setAddingSeed] = useState<string | null>(null)
  const [saleDate, setSaleDate] = useState(() => dateKeyMonrovia(Date.now()))
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const products = useLiveQuery(() => db.products.toArray(), []) ?? []
  const variants = useLiveQuery(() => db.variants.toArray(), []) ?? []
  const salesRaw = useLiveQuery(() => db.sales.toArray(), []) ?? []
  const sales = useMemo(() => withoutVoided(salesRaw), [salesRaw])

  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products])
  const qtySoldByVariant = useMemo(() => {
    const m = new Map<number, number>()
    for (const s of sales) {
      if (s.variantId == null) continue
      m.set(s.variantId, (m.get(s.variantId) ?? 0) + s.qty)
    }
    return m
  }, [sales])

  const allCandidates = useMemo<Candidate[]>(() => {
    return variants
      .filter((v) => !productById.get(v.productId)?.archived)
      .map((v) => {
        const product = productById.get(v.productId)
        if (!product) return null
        return { key: `${product.id}-${v.id}`, product, variant: v, label: variantDisplayLabel(product.name, v.label) }
      })
      .filter((c): c is Candidate => c != null)
  }, [variants, productById])

  // Leading number = quantity, e.g. "3 zi" -> qty 3, search term "zi".
  const qtyMatch = query.match(/^\s*(\d+)\s+(.*)$/)
  const impliedQty = qtyMatch ? Number(qtyMatch[1]) : 1
  const searchTerm = (qtyMatch ? qtyMatch[2] : query).trim()

  const results = useMemo(() => {
    if (!searchTerm) {
      return [...allCandidates]
        .sort((a, b) => (qtySoldByVariant.get(b.variant.id!) ?? 0) - (qtySoldByVariant.get(a.variant.id!) ?? 0))
        .slice(0, 8)
    }
    return allCandidates
      .filter((c) => itemSearchMatches(`${c.product.name} ${c.variant.label} ${c.product.category}`, searchTerm))
      .sort((a, b) => (qtySoldByVariant.get(b.variant.id!) ?? 0) - (qtySoldByVariant.get(a.variant.id!) ?? 0))
      .slice(0, 12)
  }, [searchTerm, allCandidates, qtySoldByVariant])

  function addToCart(c: Candidate, qty = impliedQty) {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.variantId === c.variant.id)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], qty: next[i].qty + qty }
        return next
      }
      return [
        ...prev,
        {
          key: uid(),
          productId: c.product.id!,
          variantId: c.variant.id!,
          label: c.label,
          unit: '',
          qty,
          price: c.variant.sellPrice,
          currency: c.variant.currency,
          cost: c.variant.costPrice,
          tbs: false,
          stock: c.variant.stockMyShop + c.variant.stockVishalShop,
        },
      ]
    })
    setQuery('')
    searchRef.current?.focus()
  }

  function bumpChip(key: string) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)))
  }

  // After the quick-add sheet creates a brand-new product+variant, find the
  // variant it just made (the newest one under that product) and drop it
  // straight into the cart -- "I must never have to leave this tab to
  // create a product."
  async function onProductCreated(productId: number) {
    setAddingSeed(null)
    const created = await db.variants.where('productId').equals(productId).last()
    const product = await db.products.get(productId)
    if (!created || !product) return
    addToCart({ key: `${productId}-${created.id}`, product, variant: created, label: variantDisplayLabel(product.name, created.label) }, impliedQty)
  }

  const itemsTotal = cart.reduce((s, l) => s + l.qty * l.price, 0)
  const itemCount = cart.reduce((s, l) => s + l.qty, 0)
  const isToday = saleDate === dateKeyMonrovia(Date.now())

  return (
    <ShopifyShell
      title="Sell"
      headerRight={
        <button
          onClick={() => setDatePickerOpen(true)}
          className="relative rounded-lg border px-2.5 py-1.5 text-xs font-bold"
          style={
            isToday
              ? { borderColor: 'rgba(251,249,244,.3)', color: 'var(--cl-bg)' }
              : { borderColor: 'var(--cl-amber)', background: 'rgba(240,162,2,.2)', color: 'var(--cl-amber)' }
          }
        >
          {isToday ? 'Today' : formatShortDateMonrovia(new Date(`${saleDate}T12:00:00`).getTime())}
          <input
            type="date"
            value={saleDate}
            max={dateKeyMonrovia(Date.now())}
            onChange={(e) => e.target.value && setSaleDate(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Sale date"
          />
        </button>
      }
    >
      <div className="flex flex-col gap-4 pb-4">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 [color:var(--cl-ink-3)]" />
          <input
            ref={searchRef}
            className={shopifyInputClass + ' pl-9 text-base font-semibold'}
            placeholder='zi… or 3 zi for three'
            value={query}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
          {qtyMatch && (
            <span
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold"
              style={{ background: 'var(--cl-amber)', color: 'var(--cl-ink)' }}
            >
              adding {impliedQty} of what you tap
            </span>
          )}
        </div>

        {cart.length > 0 && (
          <div>
            <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest [color:var(--cl-ink-3)]">
              On the counter <span className="font-medium normal-case">· tap to add one more</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {cart.map((l) => (
                <button
                  key={l.key}
                  onClick={() => bumpChip(l.key)}
                  className="inline-flex items-center gap-1.5 rounded-full border py-1.5 pl-3 pr-1.5 text-xs font-bold"
                  style={
                    l.tbs
                      ? { background: '#fff1ce', borderColor: 'var(--cl-amber)', color: 'var(--cl-ink)' }
                      : { background: 'var(--cl-card)', borderColor: 'var(--cl-line)', color: 'var(--cl-ink)' }
                  }
                >
                  {l.label}
                  <span
                    className="tabular flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold"
                    style={{ background: 'var(--cl-ink)', color: 'var(--cl-bg)' }}
                  >
                    {l.qty}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest [color:var(--cl-ink-3)]">
            {searchTerm ? 'Matches' : 'Most sold'}
          </p>
          <div className="overflow-hidden rounded-2xl border [border-color:var(--cl-line)] [background:var(--cl-card)]">
            {results.map((c) => (
              <button
                key={c.key}
                onClick={() => addToCart(c)}
                className="flex w-full items-center gap-2.5 border-b px-3 py-2.5 text-left last:border-b-0 [border-color:var(--cl-line-2)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold [color:var(--cl-ink)]">{c.label}</span>
                  <span className="tabular block text-[11px] [color:var(--cl-ink-3)]">
                    {c.variant.stockMyShop + c.variant.stockVishalShop} left · cost {money(c.variant.costPrice, c.variant.currency)}
                  </span>
                </span>
                <span className="tabular shrink-0 text-sm font-bold" style={{ color: 'var(--cl-usd)' }}>
                  {money(c.variant.sellPrice, c.variant.currency)}
                </span>
              </button>
            ))}
            <button
              onClick={() => setAddingSeed(searchTerm)}
              className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-sm font-bold [border-color:var(--cl-line)]"
              style={{ color: 'var(--cl-amber-2)' }}
            >
              <PlusIcon className="h-4 w-4 shrink-0" />
              {searchTerm ? `Add "${searchTerm}"` : 'Add a new product'}
              <span className="ml-auto text-[11px] font-medium [color:var(--cl-ink-3)]">new item or another variant</span>
            </button>
          </div>
        </div>
      </div>

      {cart.length > 0 && (
        <button
          onClick={() => setSettleOpen(true)}
          className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mx-auto flex w-full max-w-xl items-center gap-3 px-4 py-3 md:sticky md:bottom-0 md:mt-4 md:rounded-2xl"
          style={{ background: 'var(--cl-ink)', color: 'var(--cl-bg)' }}
        >
          <span className="min-w-0 flex-1 text-left">
            <span className="tabular block text-lg font-bold leading-tight">{money(itemsTotal, cart[0]?.currency ?? 'USD')}</span>
            <span className="block text-xs" style={{ color: 'rgba(251,249,244,.6)' }}>
              {itemCount} item{itemCount === 1 ? '' : 's'}
            </span>
          </span>
          <span
            className="shrink-0 rounded-xl px-4 py-2.5 text-xs font-extrabold uppercase tracking-wide"
            style={{ background: 'var(--cl-amber)', color: 'var(--cl-ink)' }}
          >
            Settle
          </span>
        </button>
      )}

      {addingSeed !== null && <AddProductFastEntryModal onClose={() => setAddingSeed(null)} onCreated={onProductCreated} />}

      {settleOpen && (
        <SettleSheet
          cart={cart}
          setCart={setCart}
          saleDate={saleDate}
          onClose={() => setSettleOpen(false)}
          onDone={() => {
            setCart([])
            setSettleOpen(false)
          }}
        />
      )}

      {datePickerOpen && (
        <BottomSheet open onClose={() => setDatePickerOpen(false)} contentClassName="![background:var(--cl-bg)] ![color:var(--cl-ink)]">
          <div className="flex flex-col gap-2 pt-2">
            <p className="px-1 text-[10px] font-bold uppercase tracking-widest [color:var(--cl-ink-3)]">Which day is this sale for?</p>
            {Array.from({ length: 7 }, (_, i) => dateKeyMonrovia(Date.now() - i * 86400000)).map((d) => (
              <button
                key={d}
                onClick={() => {
                  setSaleDate(d)
                  setDatePickerOpen(false)
                }}
                className="rounded-xl border px-3 py-2.5 text-left text-sm font-semibold"
                style={
                  d === saleDate
                    ? { borderColor: 'var(--cl-amber)', background: '#fffbf0', color: 'var(--cl-ink)' }
                    : { borderColor: 'var(--cl-line)', color: 'var(--cl-ink)' }
                }
              >
                {d === dateKeyMonrovia(Date.now()) ? 'Today' : formatShortDateMonrovia(new Date(`${d}T12:00:00`).getTime())}
                <span className="tabular ml-2 text-xs font-medium [color:var(--cl-ink-3)]">{d}</span>
              </button>
            ))}
          </div>
        </BottomSheet>
      )}
    </ShopifyShell>
  )
}

// One target at a time -- agreed price, USD, LRD, or a single line's price
// -- the keypad below writes into whichever is currently armed.
type KeypadTarget = 'agreed' | 'usd' | 'lrd' | `line:${string}`

function SettleSheet({
  cart,
  setCart,
  saleDate,
  onClose,
  onDone,
}: {
  cart: CartLine[]
  setCart: React.Dispatch<React.SetStateAction<CartLine[]>>
  saleDate: string
  onClose: () => void
  onDone: () => void
}) {
  const [location, setLocation] = useState<FulfillmentLocation>('myShop')
  const [deal, setDeal] = useState('')
  const [payUsd, setPayUsd] = useState('')
  const [payLrd, setPayLrd] = useState('')
  const [customer, setCustomer] = useState('')
  const [target, setTarget] = useState<KeypadTarget>('agreed')
  const [saving, setSaving] = useState(false)
  const [linePriceDrafts, setLinePriceDrafts] = useState<Record<string, string>>({})

  const rateRow = useLiveQuery(() => db.settings.get('exchangeRateLrdPerUsd'), [])
  const rate = rateRow ? Number(rateRow.value) : 180

  const itemsTotal = cart.reduce((s, l) => s + l.qty * l.price, 0)
  const cogsTotal = cart.reduce((s, l) => s + l.qty * l.cost, 0)
  const agreed = deal === '' ? itemsTotal : Number(deal) || 0
  const paid = (Number(payUsd) || 0) + (Number(payLrd) || 0) / rate
  const balance = agreed - paid
  const owing = balance > 0.005
  const tbsCount = cart.filter((l) => l.tbs).length
  const needsName = (owing || tbsCount > 0) && !customer.trim()

  function press(key: string) {
    const apply = (v: string) => {
      if (key === 'del') return v.slice(0, -1)
      if (key === '.') return v.includes('.') ? v : (v === '' ? '0.' : v + '.')
      return v + key
    }
    if (target === 'agreed') setDeal((v) => apply(v))
    else if (target === 'usd') setPayUsd((v) => apply(v))
    else if (target === 'lrd') setPayLrd((v) => apply(v))
    else {
      const lineKey = target.slice(5)
      setLinePriceDrafts((prev) => ({ ...prev, [lineKey]: apply(prev[lineKey] ?? '') }))
    }
  }

  function commitLinePrice(lineKey: string) {
    const draft = linePriceDrafts[lineKey]
    if (draft === undefined) return
    setCart((prev) => prev.map((l) => (l.key === lineKey ? { ...l, price: Number(draft) || 0 } : l)))
  }

  function fillRest(cur: 'usd' | 'lrd') {
    const other = cur === 'usd' ? (Number(payLrd) || 0) / rate : Number(payUsd) || 0
    const rest = Math.max(0, agreed - other)
    if (cur === 'usd') { setPayUsd(rest ? rest.toFixed(2) : ''); setTarget('usd') }
    else { setPayLrd(rest ? String(Math.round(rest * rate)) : ''); setTarget('lrd') }
  }

  async function commit() {
    if (needsName || agreed <= 0 || saving) return
    setSaving(true)
    const timestamp = saleDate === dateKeyMonrovia(Date.now()) ? Date.now() : new Date(`${saleDate}T12:00:00`).getTime()
    const totalQty = cart.reduce((s, l) => s + l.qty, 0) || cart.length
    try {
      await db.transaction('rw', db.sales, db.variants, db.settings, async () => {
        const customerNumber = await reserveNextCustomerNumber()
        const orderNumber = await reserveNextOrderNumber()
        let remaining = agreed
        for (let i = 0; i < cart.length; i++) {
          const l = cart[i]
          const isLast = i === cart.length - 1
          const share = l.qty / totalQty
          const lineAgreed = isLast ? remaining : Math.round(agreed * share * 100) / 100
          remaining -= lineAgreed

          await db.sales.add({
            productId: l.productId,
            variantId: l.variantId,
            itemName: l.label,
            qty: l.qty,
            soldFor: lineAgreed,
            costAtSale: l.cost * l.qty,
            currency: l.currency,
            timestamp,
            customerNumber,
            customerName: customer.trim() || undefined,
            orderNumber,
            location,
            tbs: l.tbs,
            pickedUp: !l.tbs,
          })

          if (!l.tbs) {
            const fresh = await db.variants.get(l.variantId)
            if (fresh) {
              const updated =
                location === 'vishalShop'
                  ? { stockVishalShop: Math.max(0, fresh.stockVishalShop - l.qty) }
                  : { stockMyShop: Math.max(0, fresh.stockMyShop - l.qty) }
              await db.variants.update(l.variantId, { ...updated, updatedAt: Date.now() })
            }
          }
        }
      })
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet open onClose={onClose} contentClassName="![background:var(--cl-bg)] ![color:var(--cl-ink)] !max-h-[92vh]">
      <div className="flex flex-col gap-3 pt-1">
        <div className="overflow-hidden rounded-2xl border [border-color:var(--cl-line)] [background:var(--cl-card)]">
          {cart.map((l) => (
            <div
              key={l.key}
              className="flex items-center gap-2 border-b px-2.5 py-2 last:border-b-0 [border-color:var(--cl-line-2)]"
              style={l.tbs ? { background: '#fffbf0' } : undefined}
            >
              <button
                onClick={() => setCart((prev) => prev.map((x) => (x.key === l.key ? { ...x, tbs: !x.tbs } : x)))}
                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border text-[9px] font-bold"
                style={
                  l.tbs
                    ? { background: 'var(--cl-amber)', borderColor: 'var(--cl-amber)', color: 'var(--cl-ink)' }
                    : { borderColor: 'var(--cl-line)', color: 'var(--cl-ink-3)' }
                }
              >
                TBS
              </button>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-bold [color:var(--cl-ink)]">{l.label}</span>
                <span className="tabular block text-[10px] [color:var(--cl-ink-3)]">
                  {l.qty} · cost {money(l.cost, l.currency)}
                  {l.tbs ? ' · collect later' : ''}
                </span>
              </span>
              <span className="flex shrink-0 items-center rounded-lg [background:var(--cl-line-2)]">
                <button
                  onClick={() => setCart((prev) => prev.map((x) => (x.key === l.key ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}
                  className="flex h-[29px] w-[29px] items-center justify-center text-lg font-bold [color:var(--cl-ink)]"
                >
                  −
                </button>
                <span className="tabular w-6 text-center text-sm font-bold">{l.qty}</span>
                <button
                  onClick={() => setCart((prev) => prev.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))}
                  className="flex h-[29px] w-[29px] items-center justify-center text-lg font-bold [color:var(--cl-ink)]"
                >
                  +
                </button>
              </span>
              <button
                onClick={() => {
                  setTarget((t) => (t === `line:${l.key}` ? 'agreed' : `line:${l.key}`))
                }}
                onBlur={() => commitLinePrice(l.key)}
                className="tabular min-w-[56px] shrink-0 rounded-md px-1 py-1 text-right text-[13px] font-bold"
                style={target === `line:${l.key}` ? { background: 'var(--cl-amber)', color: 'var(--cl-ink)' } : { color: 'var(--cl-ink)' }}
              >
                {linePriceDrafts[l.key] !== undefined ? linePriceDrafts[l.key] || '0' : l.price.toFixed(2)}
              </button>
              <button
                onClick={() => setCart((prev) => prev.filter((x) => x.key !== l.key))}
                aria-label="Remove item"
                className="shrink-0 text-base [color:var(--cl-ink-3)]"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-3.5" style={{ background: 'var(--cl-ink)', color: 'var(--cl-bg)' }}>
          <div className="flex justify-between text-[11.5px]" style={{ color: 'rgba(251,249,244,.6)' }}>
            <span>Items add up to</span>
            <span className="tabular">{money(itemsTotal, cart[0]?.currency ?? 'USD')}</span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--cl-amber)' }}>
              Agreed price
            </span>
            <button
              onClick={() => setTarget('agreed')}
              className="tabular rounded-lg px-1.5 py-0.5 text-right text-2xl font-bold"
              style={target === 'agreed' ? { background: 'var(--cl-amber)', color: 'var(--cl-ink)' } : { color: 'var(--cl-bg)' }}
            >
              {deal === '' ? itemsTotal.toFixed(2) : deal || '0'}
            </button>
          </div>
          {Math.abs(agreed - itemsTotal) > 0.005 && (
            <div className="mt-1 text-right text-[11px] font-bold" style={{ color: 'var(--cl-amber)' }}>
              {agreed < itemsTotal ? `Knocked off ${money(itemsTotal - agreed, cart[0]?.currency ?? 'USD')}` : `Added ${money(agreed - itemsTotal, cart[0]?.currency ?? 'USD')}`}
            </div>
          )}
        </div>

        {agreed < cogsTotal && (
          <div className="flex gap-2 rounded-xl px-3 py-2.5 text-[11.5px] font-semibold" style={{ background: '#fcede9', color: 'var(--cl-alarm)' }}>
            <span>⚠</span>
            <span>Under what these goods cost you ({money(cogsTotal, cart[0]?.currency ?? 'USD')}).</span>
          </div>
        )}

        {(owing || tbsCount > 0) && (
          <input
            className={shopifyInputClass}
            placeholder={owing ? 'Customer name — needed for the balance' : 'Customer name — for the TBS item'}
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          />
        )}

        <Pill
          options={[
            { label: 'My Store Floor', value: 'myShop' },
            { label: 'Warehouse (Vishal)', value: 'vishalShop' },
          ]}
          value={location}
          onChange={setLocation}
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setTarget('usd')}
            className="rounded-xl border px-3 py-2 text-left"
            style={target === 'usd' ? { borderColor: 'var(--cl-amber)', background: '#fffbf0' } : { borderColor: 'var(--cl-line)', background: 'var(--cl-card)' }}
          >
            <span className="block text-[9.5px] font-bold uppercase tracking-widest" style={{ color: 'var(--cl-usd)' }}>US dollars</span>
            <span className="tabular text-lg font-bold" style={{ color: payUsd ? 'var(--cl-ink)' : 'var(--cl-ink-3)' }}>{payUsd || '0.00'}</span>
          </button>
          <button
            onClick={() => setTarget('lrd')}
            className="rounded-xl border px-3 py-2 text-left"
            style={target === 'lrd' ? { borderColor: 'var(--cl-amber)', background: '#fffbf0' } : { borderColor: 'var(--cl-line)', background: 'var(--cl-card)' }}
          >
            <span className="block text-[9.5px] font-bold uppercase tracking-widest" style={{ color: 'var(--cl-lrd)' }}>Liberian $</span>
            <span className="tabular text-lg font-bold" style={{ color: payLrd ? 'var(--cl-ink)' : 'var(--cl-ink-3)' }}>{payLrd || '0'}</span>
          </button>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => fillRest('usd')} className="flex-1 rounded-lg border px-1 py-2 text-[10.5px] font-bold uppercase [border-color:var(--cl-line)] [background:var(--cl-card)]">Rest USD</button>
          <button onClick={() => fillRest('lrd')} className="flex-1 rounded-lg border px-1 py-2 text-[10.5px] font-bold uppercase [border-color:var(--cl-line)] [background:var(--cl-card)]">Rest LRD</button>
          <button onClick={() => { setPayUsd(''); setPayLrd('') }} className="flex-1 rounded-lg border px-1 py-2 text-[10.5px] font-bold uppercase [border-color:var(--cl-line)] [background:var(--cl-card)]">Clear</button>
        </div>
        <div className="tabular text-right text-xs font-bold" style={{ color: balance > 0.005 ? 'var(--cl-alarm)' : balance < -0.005 ? 'var(--cl-usd)' : 'var(--cl-ink-3)' }}>
          {balance > 0.005 ? `Balance ${money(balance, 'USD')}` : balance < -0.005 ? `Change ${money(-balance, 'USD')}` : 'Paid in full'}
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((k) => (
            <button
              key={k}
              onClick={() => press(k)}
              className="tabular rounded-xl border py-3 text-xl font-semibold [border-color:var(--cl-line)] [background:var(--cl-card)] [color:var(--cl-ink)]"
            >
              {k === 'del' ? '⌫' : k}
            </button>
          ))}
        </div>

        <button
          onClick={commit}
          disabled={needsName || agreed <= 0 || saving}
          className="w-full rounded-xl py-3.5 text-xs font-extrabold uppercase tracking-wide disabled:opacity-40"
          style={{ background: owing ? 'var(--cl-ink)' : 'var(--cl-amber)', color: owing ? 'var(--cl-bg)' : 'var(--cl-ink)' }}
        >
          {saving ? 'Recording…' : needsName ? 'Add the customer name' : owing ? `Record · ${money(balance, 'USD')} owing` : 'Record sale'}
        </button>
      </div>
    </BottomSheet>
  )
}
