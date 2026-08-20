// The one "which day am I working on" shared across Sell, Book, and
// Drawer -- backdating a sale in Sell, then hopping to Book or Drawer to
// check/adjust that same day, used to mean re-picking the date by hand in
// every tab. Whichever tab's date picker is touched last becomes the
// active date for all three; sessionStorage so it survives navigating
// between tabs but doesn't linger into a future, unrelated app session.
const ACTIVE_DATE_KEY = 'ledgr:activeDate'

export function loadActiveDate(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_DATE_KEY)
  } catch {
    return null
  }
}

export function storeActiveDate(key: string) {
  try {
    sessionStorage.setItem(ACTIVE_DATE_KEY, key)
  } catch {
    // no-op -- persistence is a nicety, not a hard requirement
  }
}
