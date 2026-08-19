import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useLocation } from 'react-router-dom'
import {
  db,
  reserveNextCustomerNumber,
  reserveNextOrderNumber,
  EXCHANGE_RATE_KEY,
  DEFAULT_EXCHANGE_RATE,
  UNIT_TYPES,
  type Currency,
  type FulfillmentLocation,
  type Product,
  type Variant,
} from '../db'
import { AddProductFastEntryModal } from '../components/AddProductFastEntryModal'
import { CatalogEntryCard } from '../components/CatalogEntryCard'
import { money, dateKeyMonrovia, formatShortDateMonrovia } from '../lib/format'
import { withoutVoided } from '../lib/salesLedger'
import { itemSearchMatches } from '../lib/itemMatch'
import { guessUnit } from '../lib/unitGuess'

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
  qty: number
  unitType: string
  price: number
  currency: Currency
  cost: number
  tbs: boolean
  stock: number
  priceDraft?: string
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const DAY_MS = 86400000

// How far the on-screen keyboard is currently covering the bottom of the
// layout viewport -- 0 when it's closed. `100dvh` alone isn't reliable
// enough across browsers/WebViews to keep the Settle bar above the
// keyboard, so this tracks the actual visualViewport directly.
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}

// Always includes the product name -- unlike variantDisplayLabel (which
// drops it once a variant has a real, already-descriptive label, since
// that's correct inside a nested per-product view), a flat cross-catalog
// list like Sell's search results has no other context on the row, so
// "14G" alone is meaningless without "Zinc — " in front of it.
function sellLabel(productName: string, variantLabel: string): string {
  if (variantLabel === 'Standard') return productName
  if (variantLabel.toLowerCase().includes(productName.toLowerCase())) return variantLabel
  return `${productName} — ${variantLabel}`
}

// The one screen that has to be fast: search is pinned under the header and
// autofocused, results are compact one-line rows (no grid tiles), a leading
// number in the search box sets quantity ("3 zi" = 3 of whatever zinc row
// you tap), one tap adds and clears the box, and the last result row is
// always "+ Add ..." so a brand-new item never means leaving this tab.
export default function Sell() {
  const location = useLocation()
  const [q, setQ] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [datePicker, setDatePicker] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [settleOpen, setSettleOpen] = useState(false)
  const keyboardInset = useKeyboardInset()
  const [date, setDate] = useState(() => {
    const preset = (location.state as { presetDate?: string } | null)?.presetDate
    return preset ?? dateKeyMonrovia(Date.now())
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const todayKey = dateKeyMonrovia(Date.now())
  const past = date !== todayKey

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Book's "Fill a past day" jumps here with a preset date in nav state --
  // apply it if we land here after the sheet already mounted once.
  useEffect(() => {
    const preset = (location.state as { presetDate?: string } | null)?.presetDate
    if (preset) setDate(preset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  const products = useLiveQuery(() => db.products.toArray(), []) ?? []
  const variants = useLiveQuery(() => db.variants.toArray(), []) ?? []
  const salesRaw = useLiveQuery(() => db.sales.toArray(), []) ?? []
  const sales = useMemo(() => withoutVoided(salesRaw), [salesRaw])
  const rateRow = useLiveQuery(() => db.settings.get(EXCHANGE_RATE_KEY), [])
  const rate = rateRow ? Number(rateRow.value) : DEFAULT_EXCHANGE_RATE

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
        return { key: `${product.id}-${v.id}`, product, variant: v, label: sellLabel(product.name, v.label) }
      })
      .filter((c): c is Candidate => c != null)
  }, [variants, productById])

  // Leading number = quantity, e.g. "3 zi" -> qty 3, search term "zi".
  const mQ = q.match(/^\s*(\d+)\s+(.*)$/)
  const qty = mQ ? Number(mQ[1]) : 1
  const term = (mQ ? mQ[2] : q).trim()

  const results = useMemo(() => {
    const ranked = (list: Candidate[]) => [...list].sort((a, b) => (qtySoldByVariant.get(b.variant.id!) ?? 0) - (qtySoldByVariant.get(a.variant.id!) ?? 0))
    // Idle state: a 3-across grid, so cap at 9 tiles instead of the 7-row
    // count that made sense for the old single-column list.
    if (!term) return ranked(allCandidates).slice(0, 9)
    return ranked(allCandidates.filter((c) => itemSearchMatches(`${c.product.name} ${c.variant.label} ${c.product.category}`, term))).slice(0, 12)
  }, [term, allCandidates, qtySoldByVariant])

  function add(c: Candidate, n = qty) {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.variantId === c.variant.id)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], qty: next[i].qty + n }
        return next
      }
      return [
        ...prev,
        {
          key: uid(),
          productId: c.product.id!,
          variantId: c.variant.id!,
          label: c.label,
          qty: n,
          unitType: guessUnit(`${c.product.name} ${c.variant.label}`, c.product.category),
          price: c.variant.sellPrice,
          currency: c.variant.currency,
          cost: c.variant.costPrice,
          tbs: false,
          stock: c.variant.stockMyShop + c.variant.stockVishalShop,
        },
      ]
    })
    setQ('')
    inputRef.current?.focus()
  }

  function bump(key: string) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)))
  }

  async function onProductCreated(productId: number) {
    setAdding(null)
    const created = await db.variants.where('productId').equals(productId).last()
    const product = await db.products.get(productId)
    if (!created || !product) return
    add({ key: `${productId}-${created.id}`, product, variant: created, label: sellLabel(product.name, created.label) }, qty)
  }

  const items = cart.reduce((s, l) => s + l.qty * l.price, 0)
  const count = cart.reduce((s, l) => s + l.qty, 0)
  const currency: Currency = cart[0]?.currency ?? 'USD'

  return (
    <div className="cl flex min-h-[calc(100dvh-6rem)] flex-col md:min-h-[calc(100dvh-2rem)]">
      <div className="hd">
        <div>
          <h1>Sell</h1>
          <div className="sub">{past ? 'Backdated entry' : 'Today'}</div>
        </div>
        <button className={`btn-s${past ? ' hot' : ''}`} onClick={() => setDatePicker(true)}>
          {past ? '⚠ ' : ''}{date === todayKey ? 'Today' : formatShortDateMonrovia(new Date(`${date}T12:00:00`).getTime())}
        </button>
      </div>

      <div className="srch">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='zi… or 3 zi for three'
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {mQ && <span className="qbadge">adding {qty} of what you tap</span>}
      </div>

      <div className="body">
        <div className="pad">
          {cart.length > 0 && (
            <>
              <p className="eb">On the counter<span className="n"> · tap to add one more</span></p>
              <div className="strip">
                {cart.map((l) => (
                  <button key={l.key} className={`ch${l.tbs ? ' tbs' : ''}`} onClick={() => bump(l.key)}>
                    {l.label}<span className="q">{l.qty}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="eb">{term ? 'Matches' : 'Most sold'}</p>
          {term ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.map((c) => (
                <CatalogEntryCard
                  key={c.key}
                  title={c.label}
                  cost={c.variant.costPrice}
                  sell={c.variant.sellPrice}
                  currency={c.variant.currency}
                  unit={guessUnit(`${c.product.name} ${c.variant.label}`, c.product.category)}
                  qty={c.variant.stockMyShop + c.variant.stockVishalShop}
                  rate={rate}
                  onClick={() => add(c)}
                />
              ))}
              <button className="entry" style={{ width: '100%', textAlign: 'left' }} onClick={() => setAdding(term)}>
                <b style={{ fontSize: 14, color: 'var(--cl-amber-2)' }}>+ Add "{term}"</b>
                <div style={{ fontSize: 11, color: 'var(--cl-ink-3)', marginTop: 3 }}>new item or another variant</div>
              </button>
            </div>
          ) : (
            // Idle state only -- a 3-across grid of compact tiles ranked by
            // how often each item has actually sold, all-time. Typing a
            // search term switches to the detailed single-column list above.
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {results.map((c) => (
                <button
                  key={c.key}
                  onClick={() => add(c)}
                  className="entry"
                  style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, padding: 8 }}
                >
                  <span
                    style={{
                      fontSize: 12, fontWeight: 700, color: 'var(--cl-ink)', lineHeight: 1.25,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}
                  >
                    {c.label}
                  </span>
                  <span className="m" style={{ fontSize: 12, fontWeight: 700, color: 'var(--cl-ink)' }}>
                    {money(c.variant.sellPrice, c.variant.currency)}
                  </span>
                  <span className="m" style={{ fontSize: 10, color: 'var(--cl-ink-3)' }}>
                    per {guessUnit(`${c.product.name} ${c.variant.label}`, c.product.category)}
                  </span>
                </button>
              ))}
              <button
                onClick={() => setAdding(term)}
                className="entry"
                style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 8 }}
              >
                <b style={{ fontSize: 12, color: 'var(--cl-amber-2)' }}>+ Add a new product</b>
              </button>
            </div>
          )}
        </div>
      </div>

      {cart.length > 0 && (
        <button
          className="bar"
          style={keyboardInset > 0 ? { position: 'fixed', left: 0, right: 0, bottom: keyboardInset, zIndex: 25 } : undefined}
          onClick={() => setSettleOpen(true)}
        >
          <span className="l">
            <b className="m">{money(items, currency)}</b>
            <small>{count} item{count === 1 ? '' : 's'}</small>
          </span>
          <span className="go">Settle</span>
        </button>
      )}

      {datePicker && (
        <div className="sheet" onClick={() => setDatePicker(false)}>
          <div className="sbox" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <div className="scroll" style={{ paddingBottom: 16 }}>
              <p className="eb">Which day is this sale for?</p>
              {Array.from({ length: 7 }, (_, i) => dateKeyMonrovia(Date.now() - i * DAY_MS)).map((key) => (
                <button
                  key={key}
                  className="btn ghost"
                  style={{
                    marginBottom: 8,
                    textAlign: 'left',
                    letterSpacing: 0,
                    textTransform: 'none',
                    fontSize: 14,
                    borderColor: key === date ? 'var(--cl-amber)' : 'var(--cl-line)',
                    background: key === date ? '#fffbf0' : 'transparent',
                  }}
                  onClick={() => { setDate(key); setDatePicker(false) }}
                >
                  {key === todayKey ? 'Today' : formatShortDateMonrovia(new Date(`${key}T12:00:00`).getTime())}
                  <span className="m" style={{ color: 'var(--cl-ink-3)', fontWeight: 500, marginLeft: 8 }}>{key}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {adding !== null && <AddProductFastEntryModal onClose={() => setAdding(null)} onCreated={onProductCreated} />}

      {settleOpen && (
        <SettleSheet
          cart={cart}
          setCart={setCart}
          date={date}
          past={past}
          onClose={() => setSettleOpen(false)}
          onDone={() => { setCart([]); setSettleOpen(false) }}
        />
      )}
    </div>
  )
}

type KeypadTarget = 'deal' | 'usd' | 'lrd' | `l:${string}`

function SettleSheet({
  cart,
  setCart,
  date,
  past,
  onClose,
  onDone,
}: {
  cart: CartLine[]
  setCart: React.Dispatch<React.SetStateAction<CartLine[]>>
  date: string
  past: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [location, setLocation] = useState<FulfillmentLocation>('myShop')
  const [deal, setDeal] = useState('')
  const [payU, setPayU] = useState('')
  const [payL, setPayL] = useState('')
  const [who, setWho] = useState('')
  const [focus, setFocus] = useState<KeypadTarget>('deal')
  const [saving, setSaving] = useState(false)
  const [unitPickerFor, setUnitPickerFor] = useState<string | null>(null)
  const [locationPickerOpen, setLocationPickerOpen] = useState(false)

  // Backdrop taps and the hardware back button never discard a sale in
  // progress -- only the explicit ✕ does, and only after confirming. A
  // half-built cart with real money already typed in is exactly the kind
  // of thing a stray tap outside the sheet shouldn't be able to throw away.
  function requestClose() {
    if (window.confirm('Throw away this sale?')) onClose()
  }
  useEffect(() => {
    window.history.pushState({ ledgrSettle: true }, '')
    const onPop = () => requestClose()
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (window.history.state?.ledgrSettle) window.history.back()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const savedUnitsRows = useLiveQuery(() => db.customUnits.orderBy('label').toArray(), [])
  const allUnits = [...UNIT_TYPES.filter((u) => u !== 'Other'), ...(savedUnitsRows ?? []).map((r) => r.label)]

  const rateRow = useLiveQuery(() => db.settings.get(EXCHANGE_RATE_KEY), [])
  const rate = rateRow ? Number(rateRow.value) : DEFAULT_EXCHANGE_RATE
  const currency: Currency = cart[0]?.currency ?? 'USD'

  // Effective price for a line: the in-progress typed draft while its
  // price button is armed (it may never receive a real blur event on a
  // touch keypad, so waiting for commitLinePrice to fire before the total
  // updates left the agreed price visibly stuck on stale numbers), else
  // the last committed price.
  const effPrice = (l: CartLine) => (l.priceDraft !== undefined ? Number(l.priceDraft) || 0 : l.price)
  const items = cart.reduce((s, l) => s + l.qty * effPrice(l), 0)
  // Line costs are always USD (see CatalogEntryCard) -- convert to the
  // sale's own currency before comparing against/displaying alongside the
  // agreed price, which is in that currency.
  const cogsUsd = cart.reduce((s, l) => s + l.qty * l.cost, 0)
  const cogs = currency === 'USD' ? cogsUsd : cogsUsd * rate
  const agreed = deal === '' ? items : Number(deal) || 0
  // What's been typed into the two payment boxes, converted into the
  // sale's own currency so it's directly comparable to `agreed` -- payU/
  // payL are two different currencies, not the sale currency itself, so
  // this can't just be added to `agreed` without converting one side.
  const paidUsdEquiv = (Number(payU) || 0) + (Number(payL) || 0) / rate
  const paid = currency === 'USD' ? paidUsdEquiv : paidUsdEquiv * rate
  const bal = agreed - paid
  // LRD has no decimals in real use, so its rounding noise is on the order
  // of whole units, not cents -- a fixed 0.005 threshold would flag every
  // LRD sale as "owing" from float drift alone.
  const balEps = currency === 'USD' ? 0.005 : 0.5
  const owing = bal > balEps
  const tbsN = cart.filter((l) => l.tbs).length

  // Liberian dollars are always whole numbers here -- the armed field's
  // currency decides whether the "." key does anything. payL is always
  // LRD; deal and per-line prices follow the cart's own currency.
  const armedCurrency: Currency = focus === 'lrd' ? 'LRD' : focus === 'usd' ? 'USD' : currency
  const armedIsLrd = armedCurrency === 'LRD'

  function press(k: string) {
    if (k === '.' && armedIsLrd) return
    const nx = (v: string) => (k === 'del' ? v.slice(0, -1) : k === '.' ? (v.includes('.') ? v : v === '' ? '0.' : v + '.') : v + k)
    if (focus === 'usd') setPayU(nx(payU))
    else if (focus === 'lrd') setPayL(nx(payL))
    else if (focus === 'deal') setDeal(nx(deal))
    else {
      const key = focus.slice(2)
      setCart((prev) => prev.map((l) => (l.key === key ? { ...l, priceDraft: nx(l.priceDraft ?? '') } : l)))
    }
  }

  function commitLinePrice(key: string) {
    setCart((prev) => prev.map((l) => (l.key === key && l.priceDraft !== undefined ? { ...l, price: Number(l.priceDraft) || l.price, priceDraft: undefined } : l)))
  }

  function rest(cur: 'usd' | 'lrd') {
    // Whatever's already sitting in the OTHER box, converted into the
    // sale's currency so it can be subtracted from `agreed` directly.
    const otherUsdEquiv = cur === 'usd' ? (Number(payL) || 0) / rate : Number(payU) || 0
    const otherInSaleCurrency = currency === 'USD' ? otherUsdEquiv : otherUsdEquiv * rate
    const remainingInSaleCurrency = Math.max(0, agreed - otherInSaleCurrency)
    if (cur === 'usd') {
      const usdVal = currency === 'USD' ? remainingInSaleCurrency : remainingInSaleCurrency / rate
      setPayU(usdVal ? usdVal.toFixed(2) : '')
      setFocus('usd')
    } else {
      const lrdVal = currency === 'LRD' ? remainingInSaleCurrency : remainingInSaleCurrency * rate
      setPayL(lrdVal ? String(Math.round(lrdVal)) : '')
      setFocus('lrd')
    }
  }

  async function commit() {
    if (agreed <= 0 || saving) return
    setSaving(true)
    const timestamp = past ? new Date(`${date}T12:00:00`).getTime() : Date.now()
    const totalQty = cart.reduce((s, l) => s + l.qty, 0) || cart.length
    // Round each line's slice of the agreed total (and of what was actually
    // paid) to whole LRD or 2dp USD, whichever the sale currency is --
    // matches how the totals themselves are shown, and keeps every line
    // individually well-formed rather than carrying stray fractional LRD.
    const roundAmt = (n: number) => (currency === 'LRD' ? Math.round(n) : Math.round(n * 100) / 100)
    // Never record more paid than was agreed -- anything typed past the
    // agreed price is change handed back, not money owed against this sale.
    const totalPaid = Math.min(agreed, Math.max(0, paid))
    try {
      await db.transaction('rw', db.sales, db.variants, db.settings, async () => {
        const customerNumber = await reserveNextCustomerNumber()
        const orderNumber = await reserveNextOrderNumber()
        let remaining = agreed
        let remainingPaid = totalPaid
        for (let i = 0; i < cart.length; i++) {
          const l = cart[i]
          const isLast = i === cart.length - 1
          const lineAgreed = isLast ? remaining : roundAmt(agreed * (l.qty / totalQty))
          remaining -= lineAgreed
          // This line's proportional share of what was actually collected --
          // fully paid (linePaid === lineAgreed) unless the sale as a whole
          // was left with a balance owing.
          const linePaid = isLast ? remainingPaid : roundAmt(lineAgreed * (agreed > 0 ? totalPaid / agreed : 0))
          remainingPaid -= linePaid

          await db.sales.add({
            productId: l.productId,
            variantId: l.variantId,
            itemName: l.label,
            qty: l.qty,
            unitType: l.unitType,
            soldFor: lineAgreed,
            paidAmount: linePaid,
            costAtSale: l.cost * l.qty,
            currency,
            rateAtSale: rate,
            timestamp,
            customerNumber,
            customerName: who.trim() || undefined,
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
    <div className="sheet">
      <div className="sbox" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 8px' }}>
          <button
            className="btn ghost"
            style={{ padding: '5px 12px', borderRadius: 999, letterSpacing: 0, textTransform: 'none', fontSize: 12, borderColor: 'var(--cl-line)' }}
            onClick={() => setLocationPickerOpen(true)}
          >
            {location === 'myShop' ? 'My Store Floor' : 'Warehouse (Vishal)'}
          </button>
          <button
            aria-label="Close without saving"
            onClick={requestClose}
            style={{ border: 0, background: 'none', fontSize: 20, lineHeight: 1, color: 'var(--cl-ink-3)', cursor: 'pointer', padding: 4 }}
          >
            ✕
          </button>
        </div>
        <div className="scroll">
          <div className="cart">
            {cart.map((l) => (
              <div className={`ln${l.tbs ? ' tbs' : ''}`} key={l.key}>
                <button
                  className={`tbsdot${l.tbs ? ' on' : ''}`}
                  onClick={() => setCart((prev) => prev.map((x) => (x.key === l.key ? { ...x, tbs: !x.tbs } : x)))}
                >
                  TBS
                </button>
                <span className="nm">
                  <b>{l.label}</b>
                  <small>
                    {l.qty}{' '}
                    <button onClick={() => setUnitPickerFor(l.key)} style={{ textDecoration: 'underline', color: 'inherit', font: 'inherit' }}>{l.unitType}</button>
                    {' · cost '}{money(l.cost, 'USD')}{l.tbs ? ' · collect later' : ''}
                  </small>
                </span>
                <span className="stp">
                  <button onClick={() => setCart((prev) => prev.map((x) => (x.key === l.key ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>−</button>
                  <span>{l.qty}</span>
                  <button onClick={() => setCart((prev) => prev.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))}>+</button>
                </span>
                <button
                  className={`pz${focus === `l:${l.key}` ? ' arm' : ''}${l.price < l.cost ? ' under' : ''}`}
                  onClick={() => setFocus(focus === `l:${l.key}` ? 'deal' : `l:${l.key}`)}
                  onBlur={() => commitLinePrice(l.key)}
                >
                  {l.priceDraft !== undefined ? l.priceDraft || '0' : currency === 'LRD' ? String(Math.round(l.price)) : l.price.toFixed(2)}
                </button>
                <button className="rm" onClick={() => setCart((prev) => prev.filter((x) => x.key !== l.key))}>✕</button>
              </div>
            ))}
          </div>

          <div className="deal">
            <div className="r1"><span>Items add up to</span><span className="m">{money(items, currency)}</span></div>
            <div className="r2">
              <span className="lb">Agreed price</span>
              <button className={`amt${focus === 'deal' ? ' arm' : ''}`} onClick={() => setFocus('deal')}>
                {deal === '' ? (currency === 'LRD' ? String(Math.round(items)) : items.toFixed(2)) : deal || '0'}
              </button>
            </div>
            {Math.abs(agreed - items) > balEps && (
              <div className="disc">
                {agreed < items ? `Knocked off ${money(items - agreed, currency)}` : `Added ${money(agreed - items, currency)}`}
                {' · '}
                <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setDeal('')}>reset</span>
              </div>
            )}
          </div>
          {agreed < cogs && (
            <div className="warn"><span>⚠</span><span>Under what these goods cost you ({money(cogs, currency)}).</span></div>
          )}

          {(owing || tbsN > 0) && (
            <div className="fld" style={{ marginTop: 10, marginBottom: 0 }}>
              <input className="in" value={who} onChange={(e) => setWho(e.target.value)} placeholder={owing ? 'Customer name (optional) — for the balance' : 'Customer name (optional) — for the TBS item'} />
            </div>
          )}

          <div className="cur">
            <button className={`cb u${focus === 'usd' ? ' on' : ''}`} onClick={() => setFocus('usd')}>
              <span className="t">US dollars</span><span className={`v m${payU ? '' : ' dim'}`}>{payU || '0.00'}</span>
            </button>
            <button className={`cb l${focus === 'lrd' ? ' on' : ''}`} onClick={() => setFocus('lrd')}>
              <span className="t">Liberian $</span><span className={`v m${payL ? '' : ' dim'}`}>{payL || '0'}</span>
            </button>
          </div>
          <div className="quick">
            <button onClick={() => rest('usd')}>Rest USD</button>
            <button onClick={() => rest('lrd')}>Rest LRD</button>
            <button onClick={() => { setPayU(''); setPayL('') }}>Clear</button>
          </div>
          <div className={`balr ${bal > balEps ? 'owe' : bal < -balEps ? 'chg' : 'ok'}`}>
            {bal > balEps ? `Balance ${money(bal, currency)}` : bal < -balEps ? `Change ${money(-bal, currency)}` : 'Paid in full'}
          </div>
        </div>

        <div className="foot">
          <div className="keys">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((k) => (
              <button
                key={k}
                onClick={() => press(k)}
                disabled={k === '.' && armedIsLrd}
                style={k === '.' && armedIsLrd ? { visibility: 'hidden' } : undefined}
              >
                {k === 'del' ? '⌫' : k}
              </button>
            ))}
          </div>
          <button className={`go2${owing ? ' credit' : ''}`} disabled={agreed <= 0 || saving} onClick={commit}>
            {saving ? 'Recording…' : owing ? `Record · ${money(bal, currency)} owing` : past ? 'Record for this day' : 'Record sale'}
          </button>
        </div>
      </div>

      {unitPickerFor && (
        <div className="sheet" style={{ zIndex: 55 }} onClick={(e) => { e.stopPropagation(); setUnitPickerFor(null) }}>
          <div className="sbox" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <div className="scroll" style={{ paddingBottom: 16 }}>
              <p className="eb">Sold by which unit?</p>
              <div className="units">
                {allUnits.map((u) => (
                  <button
                    key={u}
                    className={cart.find((l) => l.key === unitPickerFor)?.unitType === u ? 'on' : ''}
                    onClick={() => {
                      setCart((prev) => prev.map((x) => (x.key === unitPickerFor ? { ...x, unitType: u } : x)))
                      setUnitPickerFor(null)
                    }}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {locationPickerOpen && (
        <div className="sheet" style={{ zIndex: 55 }} onClick={() => setLocationPickerOpen(false)}>
          <div className="sbox" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <div className="scroll" style={{ paddingBottom: 16 }}>
              <p className="eb">Which stock is this coming from?</p>
              {([
                ['myShop', 'My Store Floor'],
                ['vishalShop', 'Warehouse (Vishal)'],
              ] as [FulfillmentLocation, string][]).map(([loc, label]) => (
                <button
                  key={loc}
                  className="btn ghost"
                  style={{ marginBottom: 8, textAlign: 'left', letterSpacing: 0, textTransform: 'none', fontSize: 14, borderColor: location === loc ? 'var(--cl-amber)' : 'var(--cl-line)' }}
                  onClick={() => { setLocation(loc); setLocationPickerOpen(false) }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
