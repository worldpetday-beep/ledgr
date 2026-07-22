import type { ReactNode } from 'react'

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
}: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <Card className="flex flex-col gap-1">
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
