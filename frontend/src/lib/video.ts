import type { VideoMeta } from "@/lib/types"

/** Native <video> attributes shared by every player: no download /
 * playback-rate / remote-playback entries, so Chrome never shows its
 * overflow (three-dot) menu. Exporting is the way to save clips. */
export const VIDEO_CONTROLS = {
  controls: true,
  controlsList: "nodownload noplaybackrate noremoteplayback",
  disablePictureInPicture: true,
  disableRemotePlayback: true,
} as const

/** width / height, or null when the metadata is not usable. */
export function aspectRatio(meta: VideoMeta | null | undefined): number | null {
  if (!meta || !meta.width || !meta.height) return null
  return meta.width / meta.height
}

/** CSS width for a media card whose video must fit inside `--fit-h` minus
 * the card's own chrome: a portrait clip narrows to exactly the width its
 * capped height allows (no side bars), while landscape and square clips
 * settle at a comfortable column width. Falls back to a fixed column when
 * the aspect ratio is not known yet. */
export function fitCardWidth(ratio: number | null, chromeRem: number, min = 240, max = 360): string {
  if (!ratio) return `min(100%, ${max}px)`
  return `min(100%, clamp(${min}px, calc((var(--fit-h, 100dvh) - ${chromeRem}rem) * ${ratio.toFixed(4)}), ${max}px))`
}

/** Matching max-height for the <video> inside that card. */
export function fitVideoMaxHeight(chromeRem: number): string {
  return `min(calc(var(--fit-h, 100dvh) - ${chromeRem}rem), 82dvh)`
}
