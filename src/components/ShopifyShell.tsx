import type { ReactNode } from 'react'

// Shared black-header / overlapping-white-card shell used by the Sales and
// Inventory tabs so both look like one consistent Shopify-style system.
// Deliberately hardcoded black/white (not the app's adaptive theme vars) —
// this is an intentional high-contrast look for these two screens only.
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
    <div className="flex min-h-[calc(100dvh-6rem)] flex-col md:min-h-[calc(100dvh-2rem)]">
      <div className="shrink-0 bg-black px-4 pb-6 pt-5 text-white">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{title}</h1>
          <div className="flex items-center gap-1">{headerRight}</div>
        </div>
      </div>
      <div className="-mt-4 flex-1 rounded-t-3xl bg-white px-4 pb-6 pt-5 text-black">{children}</div>
    </div>
  )
}

export const shopifyInputClass =
  'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-black placeholder:text-gray-400 outline-none focus:border-black'

export function shopifyChipClass(active: boolean): string {
  return `shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
    active ? 'border-black bg-black text-white' : 'border-gray-200 bg-white text-gray-600'
  }`
}

export const shopifyIconButtonClass =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50'

export const shopifyCardClass = 'rounded-xl border border-gray-100 bg-white p-4 shadow-sm'

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
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
    >
      {children}
    </button>
  )
}
