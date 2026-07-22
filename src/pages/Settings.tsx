import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, EXCHANGE_RATE_KEY, DEFAULT_EXCHANGE_RATE } from '../db'
import { Card, Button, inputClass, Field } from '../components/ui'
import { selectOnFocus } from '../lib/format'
import { PlusIcon, TrashIcon } from '../components/icons'

export default function Settings() {
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), [])
  const [newCategory, setNewCategory] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const rateRow = useLiveQuery(() => db.settings.get(EXCHANGE_RATE_KEY), [])
  const [rateInput, setRateInput] = useState<string | null>(null)
  const rateValue = rateInput ?? rateRow?.value ?? String(DEFAULT_EXCHANGE_RATE)

  async function saveRate(value: string) {
    setRateInput(value)
    const num = Number(value)
    if (num > 0) await db.settings.put({ key: EXCHANGE_RATE_KEY, value: String(num) })
  }

  async function addCategory() {
    const name = newCategory.trim()
    if (!name) return
    const exists = await db.categories.where('name').equalsIgnoreCase(name).first()
    if (!exists) await db.categories.add({ name })
    setNewCategory('')
  }

  async function removeCategory(id: number) {
    await db.categories.delete(id)
  }

  async function exportBackup() {
    const [items, sales, cats] = await Promise.all([
      db.items.toArray(),
      db.sales.toArray(),
      db.categories.toArray(),
    ])
    const payload = { exportedAt: new Date().toISOString(), items, sales, categories: cats }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ledgr-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setStatus('Backup downloaded.')
  }

  async function importBackup(file: File) {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      await db.transaction('rw', db.items, db.sales, db.categories, async () => {
        if (Array.isArray(data.items)) {
          for (const item of data.items) {
            const { id, ...rest } = item
            await db.items.add(rest)
          }
        }
        if (Array.isArray(data.sales)) {
          for (const sale of data.sales) {
            const { id, ...rest } = sale
            await db.sales.add(rest)
          }
        }
        if (Array.isArray(data.categories)) {
          for (const cat of data.categories) {
            const exists = await db.categories.where('name').equalsIgnoreCase(cat.name).first()
            if (!exists) await db.categories.add({ name: cat.name })
          }
        }
      })
      setStatus('Backup imported successfully.')
    } catch {
      setStatus('Could not read that file — make sure it is a Ledgr backup JSON.')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-[var(--text-secondary)]">Categories and backups</p>
      </div>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Exchange rate</h2>
        <p className="mb-3 text-sm text-[var(--text-secondary)]">
          LRD per 1 USD, for reference and the blended total shown in Analytics. Update it whenever the rate changes — it's not fetched automatically since this app is offline.
        </p>
        <Field label="Rate (L$ per $1)">
          <input
            type="number"
            min={1}
            step="1"
            className={inputClass + ' w-40'}
            value={rateValue}
            onFocus={selectOnFocus}
            onChange={(e) => saveRate(e.target.value)}
          />
        </Field>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Categories</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {(categories ?? []).map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--page-plane)] px-3 py-1 text-xs font-medium">
              {c.name}
              <button onClick={() => c.id && removeCategory(c.id)} className="text-[var(--text-muted)] hover:text-[var(--status-critical)]" aria-label="Remove">
                <TrashIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
          {(categories ?? []).length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">
              No custom categories yet — default ones are already available in the item form.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <input
            className={inputClass}
            placeholder="New category name"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
          />
          <Button onClick={addCategory}>
            <PlusIcon className="h-4 w-4" />
            Add
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Backup &amp; restore</h2>
        <p className="mb-3 text-sm text-[var(--text-secondary)]">
          All data lives only on this device. Export a backup file regularly, or to move your data to another
          phone/computer.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportBackup}>Export backup (.json)</Button>
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            Import backup
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) importBackup(file)
              e.target.value = ''
            }}
          />
        </div>
        {status && <p className="mt-2 text-xs text-[var(--text-muted)]">{status}</p>}
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">About this app</h2>
        <ul className="list-inside list-disc text-sm text-[var(--text-secondary)]">
          <li>Works fully offline — no internet or server required.</li>
          <li>All data is stored locally in this browser/device's storage.</li>
          <li>Install it to your home screen for an app-like experience (see the install prompt or your browser menu).</li>
        </ul>
      </Card>
    </div>
  )
}
