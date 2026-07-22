import { createContext, useContext } from 'react'

export interface AppActionsValue {
  openRecordSale: () => void
  showToast: (text: string, tone?: 'success' | 'error') => void
}

export const AppActionsContext = createContext<AppActionsValue | null>(null)

export function useAppActions(): AppActionsValue {
  const ctx = useContext(AppActionsContext)
  if (!ctx) throw new Error('useAppActions must be used within AppActionsContext.Provider')
  return ctx
}
