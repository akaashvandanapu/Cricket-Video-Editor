export interface VideoMeta {
  duration: number
  fps: number
  width: number
  height: number
  codec?: string
}

export interface PreviewSource {
  video: string
  meta: VideoMeta
  needs_proxy: boolean
  proxy_ready: boolean
  url: string
  using_proxy: boolean
}

export interface Params {
  preRoll: number
  postRoll: number
  sensitivity: number
  strictness: number
  minGap: number
  resolution: "1080" | "720" | "original"
  useVisual: boolean
  checkBall: boolean
  includeUnverified: boolean
}

export const DEFAULT_PARAMS: Params = {
  preRoll: 3,
  postRoll: 3,
  sensitivity: 50,
  strictness: 50,
  minGap: 3.5,
  resolution: "1080",
  useVisual: true,
  checkBall: false,
  includeUnverified: false,
}

/** Body of POST /api/process. */
export function toProcessRequest(p: Params, videos: string[]) {
  const anyVisual = p.useVisual || p.checkBall
  return {
    videos,
    sensitivity: p.sensitivity,
    strictness: p.strictness,
    use_visual: p.useVisual,
    check_ball: p.checkBall,
    include_unverified: anyVisual && p.includeUnverified,
    min_gap: p.minGap,
    pre_roll: p.preRoll,
    post_roll: p.postRoll,
    resolution: p.resolution,
  }
}

export interface Clip {
  video: string
  index: number
  filename: string
  event_time: number
  audio_snr: number
  hand_speed: number
  verified: boolean
  ball: boolean | null
  ball_track: number
  start: number
  end: number
  url: string
}

export interface StageTiming {
  scan: number
  verify: number
  cut: number
  total: number
}

export interface JobVideo {
  video: string
  state: "running" | "done" | "error"
  stage: "scanning" | "verifying" | "cutting" | "done"
  error: string | null
  timing: StageTiming
  events_total: number
  verified_done: number
  cut_done: number
  cut_total: number
  video_duration: number
  events: { time: number; audio_snr: number; hand_speed: number; verified: boolean; ball: boolean | null }[]
}

export interface JobSnapshot {
  state: "running" | "done" | "error"
  stage: "scanning" | "verifying" | "cutting" | "done"
  error: string | null
  session: string
  current: number
  timing: StageTiming
  videos: JobVideo[]
  clips: Clip[]
  candidates: number
  rejected_audio: number
  events_total: number
  verified_done: number
  rejected_visual: number
  rejected_unverified: number
  rejected_ball: number
  unverified: number
  cut_total: number
  cut_done: number
}

export interface ProxyJob {
  state: "running" | "done" | "error"
  result: { url: string } | null
  error: string | null
}

export type ExportMode = "separate" | "concat"

export interface ExportResult {
  zip_url: string | null
  concat_url: string | null
}
