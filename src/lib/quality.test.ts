import { describe, expect, it } from "vitest"

import { LOSS_DANGER, LOSS_WARN, parsePing } from "@/lib/quality"

describe("parsePing", () => {
  it("takes the last readable latency, not the first or an average", () => {
    const q = parsePing({
      ping: [
        { task_id: 1, ts: 1, latency: 100 },
        { task_id: 1, ts: 2, latency: null },
        { task_id: 1, ts: 3, latency: 180 },
      ],
      loss: {},
    })
    expect(q.latency).toBe(180)
  })

  it("drops null readings when picking the latest", () => {
    const q = parsePing({
      ping: [
        { task_id: 1, ts: 1, latency: 100 },
        { task_id: 1, ts: 2, latency: null },
        { task_id: 1, ts: 3, latency: null },
      ],
      loss: {},
    })
    expect(q.latency).toBe(100)
  })

  it("reports null latency when every reading failed", () => {
    const q = parsePing({
      ping: [
        { task_id: 1, ts: 1, latency: null },
        { task_id: 1, ts: 2, latency: null },
      ],
      loss: {},
    })
    expect(q.latency).toBeNull()
  })

  it("reads the worst loss bucket, never an average across buckets", () => {
    const q = parsePing({
      ping: [{ task_id: 1, ts: 1, latency: 50 }],
      loss: { "1": 2, "5": 22, "30": 7 },
    })
    expect(q.loss).toBe(22)
  })

  it("treats a missing loss map as zero loss, not as unknown", () => {
    const q = parsePing({ ping: [{ task_id: 1, ts: 1, latency: 50 }] })
    expect(q.loss).toBe(0)
  })

  it("survives a payload with no samples at all", () => {
    expect(parsePing({ ping: [] })).toEqual({ latency: null, loss: 0 })
    expect(parsePing({} as never)).toEqual({ latency: null, loss: 0 })
  })

  it("keeps the tier thresholds ordered", () => {
    expect(LOSS_WARN).toBeLessThan(LOSS_DANGER)
  })
})
