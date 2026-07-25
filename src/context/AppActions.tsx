import { createContext, useContext } from 'react'

export interface AppActionsValue {
  openRecordSale: () => void
  showToast: (text: string, tone?: 'success' | 'error') => void
  // Bumped each time the global FAB is tapped while the Products/Inventory
  // tab is active -- Inventory.tsx watches this to pop open its "new
  // product" editor instead of the FAB's default Record Sale action.
  addProductSignal: number
}

export const AppActionsContext = createContext<AppActionsValue | null>(null)

export function useAppActions(): AppActionsValue {
  const ctx = useContext(AppActionsContext)
  if (!ctx) throw new Error('useAppActions must be used within AppActionsContext.Provider')
  return ctx
}
