import type { ReactNode } from 'react'

// Shared dark-header / overlapping-cream-card shell used by the Book and
// Stock tabs so both look like one consistent Counter Ledger system --
// cream body, ink header, amber reserved for the active target/primary
// action only. Deliberately hardcoded to the --cl-* tokens (not the app's
// adaptive theme vars) since this is the app's one visual identity now,
// not a per-screen accent.
export function ShopifyShell({
  title,
  headerRight,
  children,
}: {
  title: string
  headerRight?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="cl flex min-h-[calc(100dvh-6rem)] flex-col md:min-h-[calc(100dvh-2rem)]">
      <div className="shrink-0 px-4 pb-6 pt-5" style={{ background: 'var(--cl-ink)', color: 'var(--cl-bg)' }}>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          <div className="flex items-center gap-1">{headerRight}</div>
        </div>
      </div>
      <div className="-mt-4 flex-1 rounded-t-3xl px-4 pb-6 pt-5" style={{ background: 'var(--cl-bg)', color: 'var(--cl-ink)' }}>
        {children}
      </div>
    </div>
  )
}

export const shopifyInputClass =
  'w-full rounded-xl border px-3 py-2.5 text-sm outline-none placeholder:font-medium'
  + ' [border-color:var(--cl-line)] [background:var(--cl-card)] [color:var(--cl-ink)]'
  + ' focus:[border-color:var(--cl-amber)]'

export function shopifyChipClass(active: boolean): string {
  return `shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
    active
      ? '[border-color:var(--cl-ink)] [background:var(--cl-ink)] [color:var(--cl-bg)]'
      : '[border-color:var(--cl-line)] [background:var(--cl-card)] [color:var(--cl-ink-2)]'
  }`
}

export const shopifyIconButtonClass =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border [border-color:var(--cl-line)] [background:var(--cl-card)] [color:var(--cl-ink-2)]'

export const shopifyCardClass = 'rounded-xl border p-4 [border-color:var(--cl-line)] [background:var(--cl-card)]'

export function ShopifyHeaderIconButton({
  onClick,
  label,
  children,
}: {
  onClick?: () => void
  label: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10"
      style={{ color: 'var(--cl-bg)' }}
    >
      {children}
    </button>
  )
}
