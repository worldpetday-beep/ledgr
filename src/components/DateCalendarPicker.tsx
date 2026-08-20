import { useState } from 'react'
import { dateKeyMonrovia } from '../lib/format'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// { year, month } where month is 1-12, parsed from a yyyy-MM-dd key (or
// today if none given) -- the month currently shown in the grid.
function monthOf(key: string | null): { year: number; month: number } {
  if (key) {
    const [y, m] = key.split('-').map(Number)
    if (y && m) return { year: y, month: m }
  }
  const todayKey = dateKeyMonrovia(Date.now())
  const [y, m] = todayKey.split('-').map(Number)
  return { year: y, month: m }
}

// A real month-grid calendar, not a native date input -- lets days with no
// sales recorded be marked directly on the grid (a small red dot) so it
// doubles as "which days do I still owe an entry for", and supports any
// date at all, not just a handful of recent ones.
export function DateCalendarPicker({
  open,
  onClose,
  value,
  onSelect,
  salesDates,
  title = 'Pick a date',
}: {
  open: boolean
  onClose: () => void
  value: string | null
  onSelect: (key: string) => void
  // Days that DO have at least one sale recorded -- everything else (up to
  // today) gets the "no sales" dot.
  salesDates: Set<string>
  title?: string
}) {
  const [view, setView] = useState(() => monthOf(value))
  if (!open) return null

  const todayKey = dateKeyMonrovia(Date.now())
  const firstOfMonth = new Date(view.year, view.month - 1, 1)
  const daysInMonth = new Date(view.year, view.month, 0).getDate()
  const startWeekday = firstOfMonth.getDay()

  function goMonth(delta: number) {
    setView((prev) => {
      const next = new Date(prev.year, prev.month - 1 + delta, 1)
      return { year: next.getFullYear(), month: next.getMonth() + 1 }
    })
  }

  const cells: (string | null)[] = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${view.year}-${pad2(view.month)}-${pad2(d)}`)

  return (
    <div className="sheet" style={{ zIndex: 65 }} onClick={onClose}>
      <div className="sbox" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="scroll" style={{ paddingBottom: 16 }}>
          <p className="eb">{title}</p>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button onClick={() => goMonth(-1)} aria-label="Previous month" style={{ padding: '6px 12px', fontSize: 16, fontWeight: 700, color: 'var(--cl-ink-2)' }}>‹</button>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cl-ink)' }}>{MONTH_NAMES[view.month - 1]} {view.year}</span>
            <button onClick={() => goMonth(1)} aria-label="Next month" style={{ padding: '6px 12px', fontSize: 16, fontWeight: 700, color: 'var(--cl-ink-2)' }}>›</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {WEEKDAYS.map((w) => (
              <div key={w} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--cl-ink-3)', padding: '4px 0' }}>{w}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((key, i) => {
              if (!key) return <div key={`blank-${i}`} />
              const isToday = key === todayKey
              const isSelected = key === value
              const isPast = key <= todayKey
              const hasSales = salesDates.has(key)
              const day = Number(key.slice(-2))
              return (
                <button
                  key={key}
                  onClick={() => { onSelect(key); onClose() }}
                  style={{
                    position: 'relative', aspectRatio: '1', borderRadius: 8, fontSize: 13, fontWeight: isToday ? 800 : 600,
                    background: isSelected ? 'var(--cl-ink)' : 'transparent',
                    color: isSelected ? 'var(--cl-bg)' : 'var(--cl-ink)',
                    border: isToday && !isSelected ? '1px solid var(--cl-amber)' : '1px solid transparent',
                  }}
                >
                  {day}
                  {isPast && !hasSales && (
                    <span
                      style={{
                        position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)',
                        width: 4, height: 4, borderRadius: '50%',
                        background: isSelected ? 'var(--cl-bg)' : 'var(--cl-alarm)',
                        opacity: isSelected ? 0.6 : 1,
                      }}
                    />
                  )}
                </button>
              )
            })}
          </div>

          <p style={{ fontSize: 11, color: 'var(--cl-ink-3)', marginTop: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--cl-alarm)', display: 'inline-block' }} />
            No sales recorded that day
          </p>
        </div>
      </div>
    </div>
  )
}
