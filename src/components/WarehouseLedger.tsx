import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_WAREHOUSE_SOURCES, WAREHOUSE_SOURCES_KEY, type WarehouseLedgerDirection } from '../db'
import { ChevronLeftIcon, PlusIcon, TrashIcon } from './icons'
import { shopifyInputClass, shopifyChipClass } from './ShopifyShell'
import { formatDateTimeMonrovia, selectOnFocus } from '../lib/format'

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b [border-color:var(--cl-line)] px-4 py-3">
      <button onClick={onBack} aria-label="Back" className="[color:var(--cl-ink)]">
        <ChevronLeftIcon className="h-5 w-5" />
      </button>
      <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
    </div>
  )
}

// Purely informational log of stock moving to/from external depots (Vishal
// Store, or up to 3 custom sources) -- deliberately decoupled from real
// store-floor inventory counts (see Inventory's Warehouse Book for that).
export function WarehouseLedgerView({ onClose }: { onClose: () => void }) {
  const settingsRow = useLiveQuery(() => db.settings.get(WAREHOUSE_SOURCES_KEY), [])
  const sources = useMemo<string[]>(() => {
    if (!settingsRow) return DEFAULT_WAREHOUSE_SOURCES
    try {
      const parsed = JSON.parse(settingsRow.value)
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_WAREHOUSE_SOURCES
    } catch {
      return DEFAULT_WAREHOUSE_SOURCES
    }
  }, [settingsRow])

  const entries = useLiveQuery(() => db.warehouseLedger.orderBy('timestamp').reverse().toArray(), [])

  const [source, setSource] = useState(sources[0])
  useEffect(() => {
    if (!sources.includes(source)) setSource(sources[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources])

  const [direction, setDirection] = useState<WarehouseLedgerDirection>('out')
  const [description, setDescription] = useState('')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [newSourceName, setNewSourceName] = useState('')
  const [manageOpen, setManageOpen] = useState(false)

  async function addEntry() {
    if (!description.trim()) return
    await db.warehouseLedger.add({
      timestamp: Date.now(),
      source,
      direction,
      description: description.trim(),
      qty: qty ? Number(qty) || undefined : undefined,
      note: note.trim() || undefined,
    })
    setDescription('')
    setQty('')
    setNote('')
  }

  async function removeEntry(id: number) {
    await db.warehouseLedger.delete(id)
  }

  async function addCustomSource() {
    const name = newSourceName.trim()
    if (!name || sources.includes(name) || sources.length >= 4) return
    await db.settings.put({ key: WAREHOUSE_SOURCES_KEY, value: JSON.stringify([...sources, name]) })
    setNewSourceName('')
  }

  async function removeCustomSource(name: string) {
    if (name === DEFAULT_WAREHOUSE_SOURCES[0]) return // keep the default source always available
    await db.settings.put({ key: WAREHOUSE_SOURCES_KEY, value: JSON.stringify(sources.filter((s) => s !== name)) })
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col [background:var(--cl-card)] [color:var(--cl-ink)]">
      <Header title="Warehouse Ledger" onBack={onClose} />
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="mb-3 text-xs [color:var(--cl-ink-2)]">
          A log of stock moving to/from external depots. This never changes your store-floor inventory counts.
        </p>

        <div className="rounded-xl border [border-color:var(--cl-line)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Source</div>
            <button onClick={() => setManageOpen((v) => !v)} className="text-xs font-medium [color:var(--cl-ink-2)] hover:[color:var(--cl-ink)]">
              {manageOpen ? 'Done' : 'Manage sources'}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <div key={s} className="flex items-center gap-1">
                <button onClick={() => setSource(s)} className={shopifyChipClass(source === s)}>
                  {s}
                </button>
                {manageOpen && s !== DEFAULT_WAREHOUSE_SOURCES[0] && (
                  <button onClick={() => removeCustomSource(s)} aria-label={`Remove ${s}`} className="[color:var(--cl-ink-3)] hover:text-red-600">
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {manageOpen && sources.length < 4 && (
            <div className="mt-2 flex items-center gap-2">
              <input
                className={shopifyInputClass}
                placeholder="Custom source name"
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
              />
              <button onClick={addCustomSource} aria-label="Add source" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full [background:var(--cl-ink)] text-white">
                <PlusIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          {(['out', 'in'] as WarehouseLedgerDirection[]).map((d) => (
            <button key={d} onClick={() => setDirection(d)} className={shopifyChipClass(direction === d) + ' flex-1'}>
              {d === 'out' ? `Sent to ${source}` : `Received from ${source}`}
            </button>
          ))}
        </div>

        <input
          className={shopifyInputClass + ' mt-3'}
          placeholder="What moved, e.g. 12 bags cement"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            type="number"
            min={0}
            className={shopifyInputClass}
            placeholder="Qty (optional)"
            value={qty}
            onFocus={selectOnFocus}
            onChange={(e) => setQty(e.target.value)}
          />
          <input className={shopifyInputClass} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button onClick={addEntry} className="mt-3 w-full rounded-lg [background:var(--cl-ink)] py-2.5 text-sm font-semibold text-white">
          Log entry
        </button>

        <div className="mt-5 flex flex-col">
          {(entries ?? []).map((e, i) => (
            <div key={e.id} className={`flex items-center justify-between gap-2 py-2.5 text-sm ${i > 0 ? 'border-t [border-color:var(--cl-line)]' : ''}`}>
              <div className="min-w-0">
                <div className="truncate font-medium">{e.description}</div>
                <div className="text-xs [color:var(--cl-ink-3)]">
                  {e.direction === 'out' ? `Sent to ${e.source}` : `Received from ${e.source}`}
                  {e.qty ? ` · ${e.qty}` : ''} · {formatDateTimeMonrovia(e.timestamp)}
                </div>
              </div>
              <button onClick={() => removeEntry(e.id!)} aria-label="Delete entry" className="shrink-0 [color:var(--cl-ink-3)] hover:text-red-600">
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
          {(entries ?? []).length === 0 && <p className="py-8 text-center text-sm [color:var(--cl-ink-2)]">No warehouse movements logged yet.</p>}
        </div>
      </div>
    </div>
  )
}
