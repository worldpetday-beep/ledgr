import { useEffect, useState } from 'react'
import { UNIT_TYPES, type FulfillmentLocation, type Sale } from '../db'
import { BottomSheet, Field, Pill, Button, inputClass } from './ui'
import { TrashIcon } from './icons'
import { selectOnFocus } from '../lib/format'
import { deleteSaleLine, editSaleLine, lrdAmountOf, usdAmountOf } from '../lib/salesLedger'

// Re-opens an already-recorded sale line for editing (qty/unit/price/
// location) or deletion — used from both today's live ledger and the Book
// Tab's archived-day view, so a data-entry mistake can be fixed no matter
// when it happened.
export function EditSaleSheet({ sale, onClose }: { sale: Sale | null; onClose: () => void }) {
  const [itemName, setItemName] = useState('')
  const [qty, setQty] = useState(1)
  const [unitType, setUnitType] = useState('Piece')
  const [customUnit, setCustomUnit] = useState('')
  const [usdAmount, setUsdAmount] = useState('')
  const [lrdAmount, setLrdAmount] = useState('')
  const [location, setLocation] = useState<FulfillmentLocation>('myShop')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!sale) return
    setItemName(sale.itemName)
    setQty(sale.qty)
    const knownUnit = !!sale.unitType && UNIT_TYPES.includes(sale.unitType)
    setUnitType(knownUnit ? sale.unitType! : sale.unitType ? 'Other' : 'Piece')
    setCustomUnit(knownUnit ? '' : sale.unitType ?? '')
    const usd = usdAmountOf(sale)
    const lrd = lrdAmountOf(sale)
    setUsdAmount(usd > 0 ? String(usd) : '')
    setLrdAmount(lrd > 0 ? String(lrd) : '')
    setLocation(sale.location)
  }, [sale])

  async function save() {
    if (!sale) return
    setSaving(true)
    await editSaleLine(sale, {
      qty: qty || 1,
      unitType: unitType === 'Other' ? customUnit.trim() || 'Other' : unitType,
      usdAmount: Number(usdAmount) || 0,
      lrdAmount: Number(lrdAmount) || 0,
      location,
      itemName: itemName.trim() || sale.itemName,
    })
    setSaving(false)
    onClose()
  }

  async function remove() {
    if (!sale) return
    setSaving(true)
    await deleteSaleLine(sale)
    setSaving(false)
    onClose()
  }

  return (
    <BottomSheet open={sale != null} onClose={() => !saving && onClose()}>
      {sale && (
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">
            Edit — {sale.itemName}
            {sale.variant ? ` — ${sale.variant}` : ''}
          </h2>

          <Field label="Item name">
            <input className={inputClass} value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </Field>

          <Field label="Quantity">
            <input
              type="number"
              min={1}
              inputMode="numeric"
              className={inputClass}
              value={qty}
              onFocus={selectOnFocus}
              onChange={(e) => setQty(Number(e.target.value) || 1)}
            />
          </Field>

          <Field label="Unit">
            <div className="grid grid-cols-3 gap-1.5">
              {UNIT_TYPES.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnitType(u)}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                    unitType === u
                      ? 'border-[var(--series-1)] bg-[var(--series-1)] text-white'
                      : 'border-[var(--border)] bg-[var(--page-plane)] text-[var(--text-secondary)]'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
            {unitType === 'Other' && (
              <input
                className={inputClass + ' mt-1.5'}
                placeholder="Custom unit"
                value={customUnit}
                onChange={(e) => setCustomUnit(e.target.value)}
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="USD">
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className={inputClass}
                value={usdAmount}
                onFocus={selectOnFocus}
                onChange={(e) => setUsdAmount(e.target.value)}
              />
            </Field>
            <Field label="LRD">
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className={inputClass}
                value={lrdAmount}
                onFocus={selectOnFocus}
                onChange={(e) => setLrdAmount(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Fulfill from">
            <Pill
              options={[
                { label: 'My Store Floor', value: 'myShop' },
                { label: 'Warehouse (Vishal)', value: 'vishalShop' },
              ]}
              value={location}
              onChange={setLocation}
            />
          </Field>

          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              onClick={remove}
              disabled={saving}
              className="flex items-center gap-1.5 text-sm font-medium text-[var(--status-critical)] disabled:opacity-50"
            >
              <TrashIcon className="h-4 w-4" />
              Delete
            </button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
