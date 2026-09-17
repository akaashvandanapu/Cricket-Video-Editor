import { useLayoutEffect, useRef } from "react"

/** Publishes the element's inner height (minus vertical padding) as the
 * CSS variable `--fit-h` on the element itself, kept fresh by a
 * ResizeObserver. Descendants use it to cap media so a whole card fits
 * inside the visible area of that scroll container, whatever the screen. */
export function useFitHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const cs = getComputedStyle(el)
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      el.style.setProperty("--fit-h", `${Math.max(0, Math.round(h))}px`)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return ref
}
