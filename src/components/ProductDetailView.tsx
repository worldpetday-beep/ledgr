import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { ItemThumb } from './ItemThumb'
import { BottomSheet } from './ui'
import { PDHeader, PDCard, pdPageClass } from './productDetailShared'
import { ProductMediaEditor } from './ProductMediaEditor'
import { ProductDetailsEditor } from './ProductDetailsEditor'
import { ProductPriceEditor } from './ProductPriceEditor'
import { ProductOptionsEditor } from './ProductOptionsEditor'
import { ProductVariantsEditor } from './ProductVariantsEditor'
import { ProductInventoryEditor } from './ProductInventoryEditor'
import { MoreVerticalIcon, ChevronRightIcon } from './icons'
import { money } from '../lib/format'

type SubScreen = 'media' | 'details' | 'price' | 'options' | 'variants' | 'inventory' | null

// The main product page: a flat, Shopify-style stack of tappable cards.
// Every card is a read-only summary of live data (useLiveQuery, so it never
// goes stale) -- editing always happens on a dedicated full-screen sub-page
// that writes straight to Dexie and hands control back here, rather than
// staging the whole product in local state and saving it all at once.
export function ProductDetailView({ productId, onClose }: { productId: number; onClose: () => void }) {
  const product = useLiveQuery(() => db.products.get(productId), [productId])
  const variants = useLiveQuery(() => db.variants.where('productId').equals(productId).sortBy('order'), [productId])

  const [subScreen, setSubScreen] = useState<SubScreen>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const priceRange = useMemo(() => {
    const list = variants ?? []
    if (list.length === 0) return null
    const currency = list[0].currency
    const prices = list.map((v) => v.sellPrice)
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    return { min, max, currency }
  }, [variants])

  const totalStock = useMemo(() => (variants ?? []).reduce((s, v) => s + v.stockMyShop + v.stockVishalShop, 0), [variants])

  async function toggleArchived() {
    if (!product) return
    await db.products.update(productId, { archived: !product.archived, updatedAt: Date.now() })
  }

  async function removeProduct() {
    if (!window.confirm(`Delete "${product?.name}" and all of its variants? This cannot be undone.`)) return
    await db.transaction('rw', db.products, db.variants, async () => {
      const vs = await db.variants.where('productId').equals(productId).toArray()
      await db.variants.bulkDelete(vs.map((v) => v.id!))
      await db.products.delete(productId)
    })
    onClose()
  }

  if (subScreen === 'media') return <ProductMediaEditor productId={productId} onClose={() => setSubScreen(null)} />
  if (subScreen === 'details') return <ProductDetailsEditor productId={productId} onClose={() => setSubScreen(null)} />
  if (subScreen === 'price') return <ProductPriceEditor productId={productId} onClose={() => setSubScreen(null)} />
  if (subScreen === 'options') return <ProductOptionsEditor productId={productId} onClose={() => setSubScreen(null)} />
  if (subScreen === 'variants') return <ProductVariantsEditor productId={productId} onClose={() => setSubScreen(null)} />
  if (subScreen === 'inventory') return <ProductInventoryEditor productId={productId} onClose={() => setSubScreen(null)} />

  if (!product || !variants) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col [background:var(--cl-card)] [color:var(--cl-ink)]">
        <PDHeader title="Product" onBack={onClose} />
        <div className="flex flex-1 items-center justify-center text-sm [color:var(--cl-ink-3)]">Loading…</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col [background:var(--cl-line-2)] [color:var(--cl-ink)]">
      <PDHeader
        title={product.name}
        onBack={onClose}
        right={
          <button onClick={() => setMenuOpen(true)} aria-label="More options" className="flex h-9 w-9 items-center justify-center rounded-full [color:var(--cl-ink)] hover:[background:var(--cl-line-2)]">
            <MoreVerticalIcon className="h-5 w-5" />
          </button>
        }
      />

      <div className={pdPageClass}>
        {/* Status -- Active/Archived, tapped directly (no sub-page for a
            single toggle). */}
        <PDCard onClick={toggleArchived}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium [color:var(--cl-ink-2)]">Product status</span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                product.archived ? '[background:var(--cl-line-2)] [color:var(--cl-ink-2)]' : 'bg-green-100 text-green-700'
              }`}
            >
              {product.archived ? 'Archived' : 'Active'}
            </span>
          </div>
        </PDCard>

        {/* Media */}
        <PDCard onClick={() => setSubScreen('media')} title={`Media (${product.images.length})`} actionLabel="View all">
          {product.images.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pt-1">
              {product.images.slice(0, 4).map((img, i) => (
                <ItemThumb key={i} image={img} size={84} className="!rounded-lg ![background:var(--cl-line-2)]" />
              ))}
            </div>
          ) : (
            <p className="text-sm [color:var(--cl-ink-3)]">No photos yet.</p>
          )}
        </PDCard>

        {/* Title / description / category */}
        <PDCard onClick={() => setSubScreen('details')}>
          <div className="flex items-start justify-between gap-2">
            <span className="text-lg font-semibold leading-snug [color:var(--cl-ink)]">{product.name}</span>
            <ChevronRightIcon className="mt-1 h-4 w-4 shrink-0 [color:var(--cl-ink-3)]" />
          </div>
          {product.description && <p className="line-clamp-2 text-sm [color:var(--cl-ink-2)]">{product.description}</p>}
          <div className="mt-1 text-sm [color:var(--cl-ink-2)]">{product.category}</div>
        </PDCard>

        {/* Price */}
        <PDCard onClick={() => setSubScreen('price')} title="Pricing" chevron>
          {priceRange ? (
            <span className="tabular text-base font-semibold [color:var(--cl-ink)]">
              {priceRange.min === priceRange.max
                ? money(priceRange.min, priceRange.currency)
                : `${money(priceRange.min, priceRange.currency)} — ${money(priceRange.max, priceRange.currency)}`}
            </span>
          ) : (
            <span className="text-sm [color:var(--cl-ink-3)]">No variants yet</span>
          )}
        </PDCard>

        {/* Options */}
        <PDCard onClick={() => setSubScreen('options')} title="Options" actionLabel={product.options.length ? 'Edit' : 'Add options'}>
          {product.options.length === 0 ? (
            <p className="text-sm [color:var(--cl-ink-3)]">No options — single variant product.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {product.options.map((o) => (
                <div key={o.name}>
                  <div className="text-xs font-semibold [color:var(--cl-ink-3)]">
                    {o.name} ({o.values.length})
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {o.values.map((v) => (
                      <span key={v} className="rounded-full [background:var(--cl-line-2)] px-2.5 py-1 text-xs font-medium [color:var(--cl-ink)]">
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </PDCard>

        {/* Variants */}
        <PDCard onClick={() => setSubScreen('variants')} title="Variants" chevron>
          <div className="flex items-center gap-2.5">
            <ItemThumb image={product.images[0]} size={36} className="!rounded-lg ![background:var(--cl-line-2)]" />
            <div>
              <div className="text-sm font-medium [color:var(--cl-ink)]">
                {variants.length} variant{variants.length === 1 ? '' : 's'}
              </div>
              {product.options.length > 0 && (
                <div className="text-xs [color:var(--cl-ink-2)]">
                  From {product.options.length} option{product.options.length === 1 ? '' : 's'}
                </div>
              )}
            </div>
          </div>
        </PDCard>

        {/* Inventory */}
        <PDCard onClick={() => setSubScreen('inventory')} title="Inventory" chevron>
          <div className="flex items-center justify-between text-sm">
            <span className="[color:var(--cl-ink-2)]">Total available</span>
            <span className="tabular font-semibold [color:var(--cl-ink)]">{totalStock}</span>
          </div>
        </PDCard>

        {/* Organization -- deliberately minimal: this app has no
            collections/vendor/source concept, so only Type (the product's
            existing category) is shown here rather than fabricating rows
            with nothing behind them. */}
        <PDCard onClick={() => setSubScreen('details')} title="Organization">
          <div className="flex items-center justify-between text-sm">
            <span className="[color:var(--cl-ink-2)]">Type</span>
            <span className="font-medium [color:var(--cl-ink)]">{product.category}</span>
          </div>
        </PDCard>
      </div>

      <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} contentClassName="![background:var(--cl-card)] ![color:var(--cl-ink)]">
        <div className="flex flex-col gap-1 pt-2">
          <h2 className="px-1 pb-2 text-sm font-semibold [color:var(--cl-ink-2)]">More options</h2>
          <button
            onClick={() => {
              setMenuOpen(false)
              removeProduct()
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-red-600 hover:[background:var(--cl-line-2)]"
          >
            Delete product
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
