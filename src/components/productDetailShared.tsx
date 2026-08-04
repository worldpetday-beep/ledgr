import type { ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'

// Shared chrome for every full-screen product-detail page/sub-page --
// deliberately hardcoded black/white/gray (not the app's adaptive theme
// vars), matching the same intentional high-contrast convention already
// used for ShopifyShell, WarehouseLogLedger, etc.
export function PDHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 bg-white px-3 py-3">
      <button onClick={onBack} aria-label="Back" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-black hover:bg-gray-100">
        <ChevronLeftIcon className="h-5 w-5" />
      </button>
      <h1 className="flex-1 truncate text-[17px] font-semibold text-black">{title}</h1>
      {right}
    </div>
  )
}

export function PDSaveButton({ onClick, saving, disabled }: { onClick: () => void; saving?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={saving || disabled}
      className="shrink-0 rounded-lg bg-black px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-30"
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  )
}

export const pdInputClass =
  'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-[15px] text-black placeholder:text-gray-400 outline-none focus:border-black'

// One flat white section on the overview page. Passing `onClick` makes the
// whole card a single tap target (rendered as a real <button>, so no
// nested-interactive-element issues); `actionLabel` renders as a plain blue
// span in the header row since it triggers the exact same navigation as
// tapping anywhere else on the card -- never a second, separately-clickable
// control.
export function PDCard({
  onClick,
  title,
  actionLabel,
  chevron,
  children,
  className = '',
}: {
  onClick?: () => void
  title?: string
  actionLabel?: string
  chevron?: boolean
  children?: ReactNode
  className?: string
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`flex w-full flex-col gap-1.5 bg-white px-4 py-4 text-left ${onClick ? 'active:bg-gray-50' : ''} ${className}`}
    >
      {title && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[15px] font-semibold text-black">{title}</span>
          <div className="flex shrink-0 items-center gap-1">
            {actionLabel && <span className="text-sm font-medium text-blue-600">{actionLabel}</span>}
            {chevron && <ChevronRightIcon className="h-4 w-4 text-gray-300" />}
          </div>
        </div>
      )}
      {children}
    </Comp>
  )
}

// Thin light-gray gutter the whole overview page scrolls inside of, so
// white cards read as distinct sections without needing individual borders
// -- matches the real Shopify product page's section separation.
export const pdPageClass = 'flex flex-1 flex-col gap-2 overflow-y-auto bg-gray-100 pb-6 pt-2'
