import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { ItemThumb } from './ItemThumb'
import { PDHeader } from './productDetailShared'
import { PlusIcon, XIcon } from './icons'

// Add/remove photos, written straight to the product's images array on
// every action -- there's nothing to stage or lose, so this page has no
// separate Save step, just a back arrow once you're done.
export function ProductMediaEditor({ productId, onClose }: { productId: number; onClose: () => void }) {
  const product = useLiveQuery(() => db.products.get(productId), [productId])
  const images = product?.images ?? []

  async function addImage(file: File) {
    await db.products.update(productId, { images: [...images, file], updatedAt: Date.now() })
  }

  async function removeImage(idx: number) {
    await db.products.update(productId, { images: images.filter((_, i) => i !== idx), updatedAt: Date.now() })
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-black">
      <PDHeader title={`Media (${images.length})`} onBack={onClose} />
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-3 gap-3">
          {images.map((img, i) => (
            <div key={i} className="relative aspect-square">
              <ItemThumb image={img} size={999} className="!h-full !w-full !rounded-xl" />
              <button
                onClick={() => removeImage(i)}
                aria-label="Remove photo"
                className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black text-white shadow"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-300 text-gray-400">
            <PlusIcon className="h-6 w-6" />
            <span className="text-xs font-medium">Add photo</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) addImage(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        {images.length === 0 && (
          <p className="mt-4 text-center text-sm text-gray-500">No photos yet. Tap the tile above to add one.</p>
        )}
      </div>
    </div>
  )
}
