import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4 ${className}`}
    >
      {children}
    </div>
  )
}

export function StatTile({
  label,
  value,
  sub,
  accent,
  className = '',
}: {
  label: string
  value: string
  sub?: string
  accent?: string
  className?: string
}) {
  return (
    <Card className={`flex flex-col gap-1 ${className}`}>
      <div className="text-xs font-medium text-[var(--text-muted)]">{label}</div>
      <div className="tabular text-2xl font-semibold" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub && <div className="text-xs text-[var(--text-secondary)]">{sub}</div>}
    </Card>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  className = '',
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  type?: 'button' | 'submit'
  className?: string
  disabled?: boolean
}) {
  const styles: Record<string, string> = {
    primary: 'bg-[var(--series-1)] text-white hover:opacity-90',
    secondary: 'bg-[var(--page-plane)] text-[var(--text-primary)] border border-[var(--border)] hover:bg-[var(--gridline)]',
    danger: 'bg-[var(--status-critical)] text-white hover:opacity-90',
    ghost: 'text-[var(--text-secondary)] hover:bg-[var(--page-plane)]',
  }
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--surface-1)] p-5 md:max-w-lg md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// Tracks how much of the viewport the on-screen keyboard is currently
// covering, via the visualViewport API (falls back to 0 -- i.e. no-op --
// wherever it's unsupported). Shared by every BottomSheet instance so a
// centered modal never gets clipped underneath the keyboard.
function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    if (!active) {
      setInset(0)
      return
    }
    const vv = window.visualViewport
    if (!vv) return
    function onResize() {
      if (!vv) return
      setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    onResize()
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
    }
  }, [active])

  return inset
}

export function BottomSheet({
  open,
  onClose,
  children,
  contentClassName = '',
  centered = false,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  contentClassName?: string
  // Opt-in: renders as a screen-centered modal (no bottom-anchored slide-up,
  // no drag-to-dismiss handle) on every breakpoint instead of the default
  // bottom-sheet-on-mobile/centered-on-desktop behavior. Both variants stay
  // clear of the on-screen keyboard via visualViewport.
  centered?: boolean
}) {
  const [dragY, setDragY] = useState(0)
  const dragging = useRef(false)
  const startY = useRef(0)
  const keyboardInset = useKeyboardInset(open)

  useEffect(() => {
    if (open) setDragY(0)
  }, [open])

  if (!open) return null

  function onPointerDown(e: PointerEvent) {
    dragging.current = true
    startY.current = e.clientY
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging.current) return
    const delta = e.clientY - startY.current
    if (delta > 0) setDragY(delta)
  }
  function onPointerUp() {
    dragging.current = false
    if (dragY > 100) {
      onClose()
    } else {
      setDragY(0)
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-black/40 ${centered ? 'items-center px-4' : 'items-end md:items-center'}`}
      style={{ paddingBottom: keyboardInset }}
      onClick={onClose}
    >
      <div
        style={{
          transform: centered ? undefined : `translateY(${dragY}px)`,
          transition: dragY === 0 ? 'transform 0.2s ease-out' : 'none',
          maxHeight: `calc(min(92vh, 100dvh - ${keyboardInset}px))`,
        }}
        className={`w-full overflow-y-auto bg-[var(--surface-1)] md:max-w-lg ${
          centered ? 'rounded-2xl' : 'rounded-t-2xl md:rounded-2xl'
        } ${contentClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {!centered && (
          <div
            className="sticky top-0 z-10 flex cursor-grab touch-none justify-center bg-inherit py-2 active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <div className="h-1.5 w-10 rounded-full bg-[var(--gridline)]" />
          </div>
        )}
        <div className={centered ? 'px-5 py-5' : 'px-5 pb-5'}>{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--page-plane)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-1)]'

export function Pill<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={`inline-flex rounded-full border border-[var(--border)] bg-[var(--page-plane)] p-1 ${className}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
            value === opt.value ? 'bg-[var(--series-1)] text-white' : 'text-[var(--text-secondary)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2">
      <span
        className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
        style={{ background: checked ? 'var(--series-1)' : 'var(--gridline)' }}
      >
        <input
          type="checkbox"
          className="absolute inset-0 opacity-0"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </span>
      {label && <span className="text-sm text-[var(--text-secondary)]">{label}</span>}
    </label>
  )
}

export interface ToastMessage {
  id: number
  text: string
  tone: 'success' | 'error'
}

export function ToastStack({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div className="fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-sm rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
            t.tone === 'success' ? 'bg-[var(--status-good)] text-white' : 'bg-[var(--status-critical)] text-white'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'good' | 'warning' | 'critical' }) {
  const styles: Record<string, string> = {
    muted: 'bg-[var(--page-plane)] text-[var(--text-secondary)]',
    good: 'bg-[var(--status-good)]/10 text-[var(--status-good)]',
    warning: 'bg-[var(--status-warning)]/15 text-[#8a5a00]',
    critical: 'bg-[var(--status-critical)]/10 text-[var(--status-critical)]',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles[tone]}`}>
      {children}
    </span>
  )
}
