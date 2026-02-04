import * as React from "react"

const MOBILE_BREAKPOINT = 768
/** Tailwind sm: 640px – below = single-column chat layout; 640+ = 2-column (tablet/desktop) */
const SMALL_MOBILE_BREAKPOINT = 640
/** Tailwind lg: 1024px – desktop gets full header bar; below = tablet/mobile get hamburger */
const DESKTOP_BREAKPOINT = 1024

/** True when viewport is below sm (640px). Use in ChatsPage so tablet gets 2-column (list + chat right) like desktop. */
export function useIsSmallMobile() {
  const [isSmallMobile, setIsSmallMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${SMALL_MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsSmallMobile(window.innerWidth < SMALL_MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    const id = setTimeout(() => setIsSmallMobile(window.innerWidth < SMALL_MOBILE_BREAKPOINT), 0)
    return () => {
      clearTimeout(id)
      mql.removeEventListener("change", onChange)
    }
  }, [])

  return !!isSmallMobile
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    // Defer initial setState to avoid setState during commit (prevents "Maximum update depth" when used inside banners/modals)
    const id = setTimeout(() => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT), 0)
    return () => {
      clearTimeout(id)
      mql.removeEventListener("change", onChange)
    }
  }, [])

  return !!isMobile
}

/** True when viewport is lg (1024px) or wider. Use for: desktop = full tab bar, below = hamburger. */
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)
    const onChange = () => {
      setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    const id = setTimeout(() => setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT), 0)
    return () => {
      clearTimeout(id)
      mql.removeEventListener("change", onChange)
    }
  }, [])

  return !!isDesktop
}
