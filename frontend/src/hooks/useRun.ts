import { useCallback, useEffect, useRef, useState } from "react"

import { getJson, postJson } from "@/lib/api"
import { toProcessRequest, type JobSnapshot, type Params } from "@/lib/types"

export interface RunState {
  jobId: string | null
  running: boolean
  done: boolean
  error: string | null // failed to start
  snapshot: JobSnapshot | null
  runParams: Params | null // what the job was started with
}

const IDLE: RunState = { jobId: null, running: false, done: false, error: null, snapshot: null, runParams: null }

const POLL_MS = 800

/** One detect -> verify -> cut job over the batch, polled while it runs. */
export function useRun() {
  const [run, setRun] = useState<RunState>(IDLE)
  const jobRef = useRef<string | null>(null)

  const clear = useCallback(() => {
    jobRef.current = null
    setRun(IDLE)
  }, [])

  const start = useCallback(async (params: Params, videos: string[]) => {
    jobRef.current = null
    setRun({ ...IDLE, running: true, runParams: params })
    try {
      const { job_id } = await postJson<{ job_id: string }>("/api/process", toProcessRequest(params, videos))
      jobRef.current = job_id
      setRun((r) => (r.running ? { ...r, jobId: job_id } : r))
    } catch (err) {
      setRun({ ...IDLE, error: (err as Error).message })
    }
  }, [])

  useEffect(() => {
    if (!run.jobId || !run.running) return
    const jobId = run.jobId
    let stopped = false
    const tick = async () => {
      let snap: JobSnapshot
      try {
        snap = await getJson<JobSnapshot>(`/api/jobs/${jobId}`)
      } catch {
        return // backend hiccup: try again next tick
      }
      if (stopped || jobRef.current !== jobId) return // cleared while in flight
      const finished = snap.state === "done" || snap.state === "error"
      setRun((r) => ({ ...r, snapshot: snap, running: !finished, done: snap.state === "done" }))
      if (finished) clearInterval(timer)
    }
    const timer = setInterval(tick, POLL_MS)
    void tick()
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [run.jobId, run.running])

  return { run, start, clear }
}
