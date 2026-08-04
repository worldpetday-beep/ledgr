import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_CATEGORIES } from '../db'
import { PDHeader, PDSaveButton, pdInputClass } from './productDetailShared'

export function ProductDetailsEditor({ productId, onClose }: { productId: number; onClose: () => void }) {
  const product = useLiveQuery(() => db.products.get(productId), [productId])
  const allCategories = useLiveQuery(() => db.categories.toArray(), [])

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!product || loaded) return
    setName(product.name)
    setDescription(product.description)
    setCategory(product.category)
    setLoaded(true)
  }, [product, loaded])

  const categoryOptions = useMemo(
    () => Array.from(new Set([...DEFAULT_CATEGORIES, ...(allCategories ?? []).map((c) => c.name)])).sort(),
    [allCategories],
  )

  async function save() {
    if (!name.trim() || saving) return
    setSaving(true)
    await db.products.update(productId, {
      name: name.trim(),
      description,
      category: category.trim() || 'General',
      updatedAt: Date.now(),
    })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-black">
      <PDHeader title="Title & description" onBack={onClose} right={<PDSaveButton onClick={save} saving={saving} disabled={!name.trim()} />} />
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Title</label>
            <input className={pdInputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Description</label>
            <textarea
              className={pdInputClass + ' min-h-[140px] resize-y'}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Category</label>
            <input list="pd-category-list" className={pdInputClass} value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="pd-category-list">
              {categoryOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
      </div>
    </div>
  )
}
