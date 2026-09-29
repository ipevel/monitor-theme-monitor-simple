import { describe, expect, it } from "vitest"

import { LOSS_DANGER, LOSS_WARN, parsePing } from "@/lib/quality"

describe("parsePing", () => {
  it("takes the newest readable latency by ts, not the first or an average", () => {
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

  /**
   * The endpoint promises nothing about row order, and the previous
   * implementation took `timed[timed.length - 1]` -- so a reversed page
   * reported the *oldest* reading as the current one.
   */
  it("picks the newest sample even when the rows arrive out of order", () => {
    const q = parsePing({
      ping: [
        { task_id: 1, ts: 300, latency: 180 },
        { task_id: 1, ts: 100, latency: 42 },
        { task_id: 1, ts: 200, latency: 99 },
      ],
      loss: {},
    })
    expect(q.latency).toBe(180)
  })

  it("picks the newest sample when the page is reversed", () => {
    const q = parsePing({
      ping: [
        { task_id: 1, ts: 30, latency: 200 },
        { task_id: 1, ts: 20, latency: 150 },
        { task_id: 1, ts: 10, latency: 100 },
      ],
      loss: {},
    })
    expect(q.latency).toBe(200)
  })

  it("ignores a row whose ts cannot be placed in time", () => {
    // A sample without a usable ts cannot be compared against the others, so
    // it must not win merely by sitting at the end of the array.
    const q = parsePing({
      ping: [
        { task_id: 1, ts: 10, latency: 100 },
        { task_id: 1, ts: Number.NaN, latency: 999 },
      ],
      loss: {},
    })
    expect(q.latency).toBe(100)
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
