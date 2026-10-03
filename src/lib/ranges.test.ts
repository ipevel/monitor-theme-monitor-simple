import { describe, expect, it } from "vitest"

import { BASE_RANGES, rangesFor, rangesOn, spanFor } from "./ranges"

const hours = (offers: { hours: number }[]) => offers.map((r) => r.hours)

describe("rangesFor", () => {
  it("offers the week-long list when the hub says nothing", () => {
    // Every hub before v1.3.2 omits `history_days`, and a week is the retention
    // those hubs actually have -- the clamp the theme used to hard-code.
    for (const days of [undefined, null]) {
      expect(hours(rangesFor(days))).toEqual([1, 6, 24, 168])
    }
  })

  it("still offers the week-long list for a hub keeping a week or less", () => {
    for (const days of [1, 3, 7]) {
      expect(hours(rangesFor(days))).toEqual([1, 6, 24, 168])
    }
  })

  it("adds one window reaching the hub's retention when it keeps more", () => {
    expect(hours(rangesFor(30))).toEqual([1, 6, 24, 168, 720])
    expect(rangesFor(30).at(-1)?.label).toBe("30 天")
  })

  it("labels a year or more in years", () => {
    expect(rangesFor(365).at(-1)?.label).toBe("1 年")
    expect(rangesFor(400).at(-1)?.label).toBe("1 年")
    expect(rangesFor(364).at(-1)?.label).toBe("364 天")
  })

  it("never shrinks the list below what every hub can serve", () => {
    // A hub reporting nonsense must not cost the visitor the standard windows.
    for (const days of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(hours(rangesFor(days))).toEqual([1, 6, 24, 168])
    }
  })

  it("keeps the base windows first, whatever the retention", () => {
    expect(rangesFor(9000).slice(0, 4)).toEqual(BASE_RANGES)
  })
})

describe("rangesOn", () => {
  it("drops the week-long window on the latency tab", () => {
    expect(hours(rangesOn(rangesFor(30), "latency"))).toEqual([1, 6, 24])
  })

  it("offers everything on the resources tab", () => {
    const offers = rangesFor(30)
    expect(rangesOn(offers, "resources")).toBe(offers)
  })
})

describe("spanFor", () => {
  it("keeps a selection that is still on offer", () => {
    expect(spanFor(rangesFor(30), 720)).toBe(720)
  })

  it("falls back to the widest window still on offer", () => {
    // The case that matters: 7 天 is picked, then the latency tab narrows the
    // list, and asking for 168 would light no button and draw the wrong span.
    expect(spanFor(rangesOn(rangesFor(30), "latency"), 168)).toBe(24)
  })

  it("falls back when a hub's retention shrinks under a wider pick", () => {
    expect(spanFor(rangesFor(3), 720)).toBe(168)
  })
})
