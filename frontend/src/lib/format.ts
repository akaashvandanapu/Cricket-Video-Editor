/** Seconds -> "m:ss". */
export function fmtDuration(sec: number | undefined | null): string {
  const s = Math.max(0, Math.round(sec || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** Seconds -> "12s" under a minute, otherwise "m:ss". For run timings. */
export function fmtElapsed(sec: number | undefined | null): string {
  const s = Math.max(0, Math.round(sec || 0))
  return s < 60 ? `${s}s` : fmtDuration(s)
}

export function plural(n: number, word: string, words = word + "s"): string {
  return `${n} ${n === 1 ? word : words}`
}

export const VIDEO_FILE_RE = /\.(mp4|mov|m4v|mkv|avi)$/i
