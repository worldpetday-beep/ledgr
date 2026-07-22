import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_CATEGORIES, type Currency, type Item } from '../db'
import { Card, Button, Modal, Field, inputClass, Badge, Switch, Pill } from '../components/ui'
import { PlusIcon, SearchIcon, EditIcon, TrashIcon } from '../components/icons'
import { ItemThumb } from '../components/ItemThumb'
import { money, isLowStock } from '../lib/format'

const emptyForm = {
  name: '',
  category: DEFAULT_CATEGORIES[0],
  variant: '',
  sku: '',
  costPrice: 0,
  costUnknown: false,
  sellPrice: 0,
  currency: 'USD' as Currency,
  stock: 0,
  lowStockThreshold: 3,
  image: undefined as Blob | undefined,
}

export default function Inventory() {
  const items = useLiveQuery(() => db.items.orderBy('name').toArray(), [])
  const categories = useLiveQuery(() => db.categories.toArray(), [])
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('All')
  const [missingCostOnly, setMissingCostOnly] = useState(false)
  const [view, setView] = useState<'list' | 'visual'>('list')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)
  const [form, setForm] = useState(emptyForm)

  const missingCostCount = useMemo(() => (items ?? []).filter((i) => i.costUnknown).length, [items])

  const allCategories = useMemo(() => {
    const fromItems = new Set((items ?? []).map((i) => i.category))
    const fromDb = new Set((categories ?? []).map((c) => c.name))
    return Array.from(new Set([...DEFAULT_CATEGORIES, ...fromDb, ...fromItems])).sort()
  }, [items, categories])

  const filtered = useMemo(() => {
    let list = items ?? []
    if (categoryFilter !== 'All') list = list.filter((i) => i.category === categoryFilter)
    if (missingCostOnly) list = list.filter((i) => i.costUnknown)
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(
        (i) => i.name.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q) || i.variant.toLowerCase().includes(q),
      )
    }
    // Items missing a cost float to the top so they're easy to fill in.
    return [...list].sort((a, b) => Number(b.costUnknown) - Number(a.costUnknown) || a.name.localeCompare(b.name))
  }, [items, query, categoryFilter, missingCostOnly])

  const byCategory = useMemo(() => {
    const groups = new Map<string, Item[]>()
    for (const item of filtered) {
      const list = groups.get(item.category) ?? []
      list.push(item)
      groups.set(item.category, list)
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(item: Item) {
    setEditing(item)
    setForm({
      name: item.name,
      category: item.category,
      variant: item.variant,
      sku: item.sku ?? '',
      costPrice: item.costPrice,
      costUnknown: item.costUnknown,
      sellPrice: item.sellPrice,
      currency: item.currency,
      stock: item.stock,
      lowStockThreshold: item.lowStockThreshold,
      image: item.image,
    })
    setModalOpen(true)
  }

  async function save() {
    if (!form.name.trim()) return
    const now = Date.now()
    if (editing?.id) {
      await db.items.update(editing.id, { ...form, updatedAt: now })
    } else {
      await db.items.add({ ...form, createdAt: now, updatedAt: now })
    }
    setModalOpen(false)
  }

  async function remove(id: number) {
    await db.items.delete(id)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Inventory Manager</h1>
          <p className="text-sm text-[var(--text-secondary)]">{items?.length ?? 0} SKUs tracked so far</p>
        </div>
        <div className="flex items-center gap-2">
          <Pill options={[{ label: 'List', value: 'list' }, { label: 'Visual', value: 'visual' }]} value={view} onChange={setView} />
          <Button onClick={openAdd}>
            <PlusIcon className="h-4 w-4" />
            Add item
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            className={inputClass + ' pl-9'}
            placeholder="Search by name, variant, or SKU"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className={inputClass + ' w-auto'} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="All">All categories</option>
          {allCategories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {missingCostCount > 0 && (
          <button
            onClick={() => setMissingCostOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              missingCostOnly
                ? 'border-[var(--series-1)] bg-[var(--series-1)]/10 text-[var(--series-1)]'
                : 'border-[var(--border)] bg-[var(--page-plane)] text-[var(--text-secondary)]'
            }`}
          >
            Missing cost <Badge tone="warning">{missingCostCount}</Badge>
          </button>
        )}
      </div>

      {view === 'list' ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-[var(--text-muted)]">
                  <th className="pb-2 font-medium"></th>
                  <th className="pb-2 font-medium">Item</th>
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 font-medium">Variant</th>
                  <th className="pb-2 font-medium">Stock</th>
                  <th className="pb-2 font-medium">Cost</th>
                  <th className="pb-2 font-medium">Sell</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const low = isLowStock(item.stock, item.lowStockThreshold)
                  return (
                    <tr key={item.id} className="border-t border-[var(--gridline)]">
                      <td className="py-2 pr-2">
                        <ItemThumb image={item.image} size={32} />
                      </td>
                      <td className="py-2 pr-2 font-medium">{item.name}{item.sku && <span className="ml-1 text-xs text-[var(--text-muted)]">#{item.sku}</span>}</td>
                      <td className="py-2 pr-2 text-[var(--text-secondary)]">{item.category}</td>
                      <td className="py-2 pr-2 text-[var(--text-secondary)]">{item.variant || '—'}</td>
                      <td className="py-2 pr-2">
                        <span className="tabular">{item.stock}</span>
                        {low && <Badge tone="critical">Low</Badge>}
                      </td>
                      <td className="py-2 pr-2">
                        {item.costUnknown ? (
                          <button onClick={() => openEdit(item)}>
                            <Badge tone="warning">Cost missing</Badge>
                          </button>
                        ) : (
                          <span className="tabular text-[var(--text-muted)]">{money(item.costPrice, item.currency)}</span>
                        )}
                      </td>
                      <td className="tabular py-2 pr-2">{money(item.sellPrice, item.currency)}</td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => openEdit(item)} className="text-[var(--text-muted)] hover:text-[var(--series-1)]" aria-label="Edit">
                            <EditIcon className="h-4 w-4" />
                          </button>
                          <button onClick={() => item.id && remove(item.id)} className="text-[var(--text-muted)] hover:text-[var(--status-critical)]" aria-label="Delete">
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-sm text-[var(--text-muted)]">
                      No items yet. Add them as you go — you don't need it all at once.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {byCategory.map(([category, catItems]) => {
            const maxStock = Math.max(1, ...catItems.map((i) => i.stock))
            return (
              <Card key={category}>
                <h2 className="mb-3 text-sm font-semibold">{category}</h2>
                <div className="flex flex-wrap gap-2.5">
                  {catItems.map((item) => {
                    const low = isLowStock(item.stock, item.lowStockThreshold)
                    const ok = item.stock > item.lowStockThreshold * 2
                    const tone = low ? 'critical' : ok ? 'good' : 'warning'
                    const scale = 0.85 + 0.65 * Math.min(1, item.stock / maxStock)
                    const toneColor =
                      tone === 'critical' ? 'var(--status-critical)' : tone === 'good' ? 'var(--status-good)' : 'var(--status-warning)'
                    return (
                      <button
                        key={item.id}
                        onClick={() => openEdit(item)}
                        style={{
                          borderColor: toneColor,
                          transform: `scale(${scale})`,
                          transformOrigin: 'center',
                        }}
                        className="flex min-w-[110px] flex-col items-center gap-1.5 rounded-xl border-2 bg-[var(--page-plane)] px-3 py-2.5 text-center transition-transform"
                      >
                        <ItemThumb image={item.image} size={36} />
                        <span className="line-clamp-1 text-xs font-medium">{item.name}</span>
                        <span className="tabular text-sm font-semibold" style={{ color: toneColor }}>
                          {item.stock}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </Card>
            )
          })}
          {byCategory.length === 0 && (
            <Card>
              <p className="py-4 text-center text-sm text-[var(--text-muted)]">
                No items yet. Add them as you go — you don't need it all at once.
              </p>
            </Card>
          )}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit item' : 'Add item'}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <ItemThumb image={form.image} size={56} />
            <label className="cursor-pointer text-sm font-medium text-[var(--series-1)]">
              {form.image ? 'Change photo' : 'Add photo'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) setForm({ ...form, image: file })
                }}
              />
            </label>
            {form.image && (
              <button onClick={() => setForm({ ...form, image: undefined })} className="text-sm text-[var(--text-muted)] hover:text-[var(--status-critical)]">
                Remove
              </button>
            )}
          </div>
          <Field label="Name">
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <input list="category-list" className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              <datalist id="category-list">
                {allCategories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </Field>
            <Field label="Variant (size/color/pack)">
              <input className={inputClass} value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value })} />
            </Field>
          </div>
          <Field label="SKU / barcode (optional)">
            <input className={inputClass} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sell price">
              <input type="number" min={0} step="0.01" className={inputClass} value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Currency">
              <select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}>
                <option value="USD">USD</option>
                <option value="LRD">LRD</option>
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--page-plane)] p-2.5">
            <Switch
              checked={form.costUnknown}
              onChange={(v) => setForm({ ...form, costUnknown: v, costPrice: v ? 0 : form.costPrice })}
              label="I don't know the cost yet"
            />
            {!form.costUnknown && (
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder="Cost price"
                className={inputClass + ' w-32'}
                value={form.costPrice}
                onChange={(e) => setForm({ ...form, costPrice: Number(e.target.value) || 0 })}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stock on hand">
              <input type="number" min={0} className={inputClass} value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Low stock alert below">
              <input type="number" min={0} className={inputClass} value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? 'Save changes' : 'Add item'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
