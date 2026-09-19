import { median } from "d3-array"

/** One latency sample from one probe.
 *
 * `band` is the envelope the hub computes around the sample and is empty
 * whenever only one probe is displayed; `loss` is that bucket's packet loss. */
export type PingPoint = {
  task_id: number
  ts: number
  latency: number | null
  band?: [number, number]
  loss?: number
}

/**
 * Replaces an isolated latency spike with the local median.
 *
 * Median absolute deviation rather than the standard deviation: one 400 ms read
 * inflates a standard deviation enough to hide itself, which is exactly the
 * sample this exists to catch. 1.4826 rescales MAD into a standard deviation for
 * normally distributed data, so `sigmas` keeps its usual meaning.
 *
 * The substitute is the median already computed over the window, so the
 * corrected point sits on the surrounding trend instead of being interpolated
 * towards it.
 */
export function despike(points: PingPoint[], window = 7, sigmas = 3): PingPoint[] {
  const half = window >> 1
  return points.map((p, i) => {
    if (p.latency === null) return p
    const near = points
      .slice(Math.max(0, i - half), i + half + 1)
      .map((x) => x.latency)
      .filter((v): v is number => v !== null)
    const mid = median(near) ?? p.latency
    const mad = median(near.map((v) => Math.abs(v - mid))) ?? 0
    const outlier = mad > 0 && Math.abs(p.latency - mid) > sigmas * 1.4826 * mad
    return outlier ? { ...p, latency: mid } : p
  })
}
