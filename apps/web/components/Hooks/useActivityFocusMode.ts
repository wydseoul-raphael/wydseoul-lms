'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

// Learners can hide the site chrome while inside an activity ("focus mode").
// The flag lives in localStorage so it survives navigation; the activity page
// broadcasts `focusModeChange` when it flips, and `storage` covers other tabs.
// Only activity pages honour it, so any other route always reports false.
export function useActivityFocusMode(): boolean {
  const pathname = usePathname()
  const [isFocusMode, setIsFocusMode] = useState(false)

  useEffect(() => {
    const onActivityPage = !!pathname?.includes('/activity/')
    const read = () => {
      if (!onActivityPage) return false
      try {
        return localStorage.getItem('globalFocusMode') === 'true'
      } catch {
        return false
      }
    }
    // Read once on route change, then subscribe.
    const frame = requestAnimationFrame(() => setIsFocusMode(read()))
    const sync = () => setIsFocusMode(read())
    window.addEventListener('storage', sync)
    window.addEventListener('focusModeChange', sync as EventListener)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('storage', sync)
      window.removeEventListener('focusModeChange', sync as EventListener)
    }
  }, [pathname])

  return isFocusMode
}

export default useActivityFocusMode
