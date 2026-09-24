import { describe, expect, it } from "vitest"

import { backoffMs, safeNodes, sameList, type Node } from "@/lib/api"
import { bytes, cpuName, daysToReset, osName, uptime } from "@/lib/format"
import { expiryDays, health, monthUsage, worstSeverity } from "@/lib/node"
import { chunk, freshReadings } from "@/lib/quality"
import { withHysteresis } from "@/lib/severity"

/*
 * The gaps a review of the whole source tree found, grouped by the module they
 * belong to rather than by file. Each case here is a behaviour with a real way
 * to break and, before this, nothing asserting it -- these are not repeats of
 * what the neighbouring suites already cover.
 */

const GiB = 1024 ** 3

/** Only the fields each case below reads; the rest of a Node is absent. */
function make(over: Record<string, unknown> = {}): Node {
  return {
    id: 1,
    name: "n1",
    online: true,
    cpu_cores: 2,
    mem_total: 8 * GiB,
    disk_total: 100 * GiB,
    month_rx: 10 * GiB,
    month_tx: 5 * GiB,
    traffic_mode: "sum",
    last_seen: Math.floor(Date.now() / 1000),
    ...over,
  } as unknown as Node
}

function metrics(over: Record<string, unknown> = {}): NonNullable<Node["metrics"]> {
  return {
    cpu: 8,
    mem_used: 2 * GiB,
    disk_used: 40 * GiB,
    net_rx: 0,
    net_tx: 0,
    load: [0.4, 0.4, 0.4],
    ...over,
  } as unknown as NonNullable<Node["metrics"]>
}

describe("monthUsage", () => {
  it("counts only the direction the plan is billed on", () => {
    // An upstream-only plan charged on 5 GiB must not draw a bar for 15 GiB:
    // it would read as three times closer to its limit than it is, and the
    // "this month" sort would rank it above hosts that really did more.
    expect(monthUsage(make({ traffic_mode: "up" }))).toBe(5 * GiB)
    expect(monthUsage(make({ traffic_mode: "down" }))).toBe(10 * GiB)
    expect(monthUsage(make({ traffic_mode: "max" }))).toBe(10 * GiB)
    expect(monthUsage(make({ traffic_mode: "sum" }))).toBe(15 * GiB)
    // A mode added later falls back to the sum, not to zero.
    expect(monthUsage(make({ traffic_mode: "?" }))).toBe(15 * GiB)
  })

  it("believes the hub's own figure where it sends one", () => {
    // The hub meters the allowance itself now, and its number is what the panel
    // and the traffic alert read. Where the two would disagree, the card has to
    // say the same thing as the alert that was sent about it.
    expect(monthUsage(make({ month_used: 7 * GiB, traffic_mode: "sum" }))).toBe(7 * GiB)
    expect(monthUsage(make({ month_used: 0, traffic_mode: "sum" }))).toBe(0)
  })

  it("adds the directions up itself only for a hub that predates the field", () => {
    expect(monthUsage(make({ month_used: null, traffic_mode: "up" }))).toBe(5 * GiB)
    expect(monthUsage(make({ month_used: undefined, traffic_mode: "down" }))).toBe(10 * GiB)
    // And a hub field arriving as the wrong primitive is not a reading.
    expect(monthUsage(make({ month_used: "12", traffic_mode: "up" }))).toBe(5 * GiB)
    expect(monthUsage(make({ month_used: Number.NaN, traffic_mode: "up" }))).toBe(5 * GiB)
  })
})

describe("expiryDays", () => {
  /** A date `offset` days from today, written the way the hub writes one. */
  const iso = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    const m = String(d.getMonth() + 1).padStart(2, "0")
    return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, "0")}`
  }

  it("counts on the hub's calendar, not the visitor's", () => {
    /*
     * The count and the date are not the same number. The hub's day is the one
     * the renewals are reckoned on; the date is read against each visitor's own
     * clock, and one far enough from the hub's timezone saw an online node as
     * 已过期 on the day before its renewal. Where the hub sends a count, it wins.
     */
    expect(expiryDays(make({ expires_in: 3, expires_at: iso(30) }))).toBe(3)
    // Zero is a reading -- renews today -- not "no answer"; falling through to
    // the date would have disagreed with the hub by whole days.
    expect(expiryDays(make({ expires_in: 0, expires_at: iso(30) }))).toBe(0)
  })

  it("keeps a negative count, which is the answer it is read for", () => {
    // A node past its date, which the card prints as 已过期 N 天 -- and which
    // `usable()` would have discarded for being below zero.
    expect(expiryDays(make({ expires_in: -2, expires_at: iso(1) }))).toBe(-2)
  })

  it("reads the date itself only for a hub that predates the field", () => {
    expect(expiryDays(make({ expires_at: iso(5) }))).toBe(5)
    expect(expiryDays(make({ expires_in: null, expires_at: iso(-1) }))).toBe(-1)
    // A hub field arriving as the wrong primitive is not a reading.
    expect(expiryDays(make({ expires_in: "3", expires_at: iso(5) }))).toBe(5)
  })

  it("has no answer for a node that never expires", () => {
    expect(expiryDays(make({ expires_at: null }))).toBeNull()
    expect(expiryDays(make({ expires_in: null, expires_at: null }))).toBeNull()
  })
})

describe("health", () => {
  it("names all five states, and does not confuse the two that look alike", () => {
    expect(health(make({ metrics: metrics() }))).toBe("ok")
    // Has reported hardware before, so it has gone away.
    expect(health(make({ online: false }))).toBe("offline")
    // Never reported any: it is not set up, which is not the same as broken.
    expect(health(make({ online: false, cpu_cores: 0, mem_total: 0 }))).toBe("unconnected")
    expect(health(make({ metrics: null }))).toBe("pending")
    // The pair that used to collapse: an agent waiting for its first sample
    // versus data that arrived and cannot be trusted.
    expect(health(make({ metrics: null, metrics_invalid: true }))).toBe("invalid")
  })
})

describe("worstSeverity", () => {
  it("drops a column that goes missing instead of holding its colour", () => {
    const hot = make({ id: 91, metrics: metrics({ cpu: 95 }) })
    expect(worstSeverity(hot)).toBe("danger")
    // Hysteresis remembers the last level per node, which is what stops a
    // reading hovering on a threshold from flipping the card twice a second.
    // It must not outlive the reading itself: a node whose CPU sample
    // disappears would otherwise stay red on a number that is not there.
    expect(worstSeverity(make({ id: 91, metrics: metrics({ cpu: null }) }))).toBe("normal")
  })
})

describe("bytes", () => {
  it("keeps zero and 'no figure' apart", () => {
    // See the dash cases in format.test.ts; the pair matters more than either
    // half -- a zero is a reading, a dash is the absence of one.
    expect(bytes(0)).toBe("0 B")
    expect(bytes(-1)).toBe("—")
  })

  it("has a unit left above a petabyte", () => {
    expect(bytes(1024 ** 6)).toBe("1.00 EB")
  })
})

describe("uptime", () => {
  it("picks the largest unit that carries information", () => {
    expect(uptime(0)).toBe("—")
    expect(uptime(45)).toBe("0 分")
    expect(uptime(3 * 3600 + 300)).toBe("3 小时 5 分")
    // The day figure must not swallow the hours: "2 天" reads the same for a
    // host up two days and one up two days and twenty hours.
    expect(uptime(2 * 86400 + 3 * 3600)).toBe("2 天 3 小时")
  })
})

describe("vendor strings", () => {
  it("strips what the vendor padded the name with", () => {
    // Both of these lines have a column to fit in, and the codename or the
    // "(R) ... Processor" tail is what pushes them out of it.
    expect(osName("Debian GNU/Linux 12 (bookworm)")).toBe("Debian 12")
    expect(cpuName("Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz 8-Core Processor")).toBe(
      "Intel Xeon E5-2680 v4 @ 2.40GHz",
    )
  })
})

describe("daysToReset", () => {
  it("crosses the year boundary", () => {
    // 25 December, resetting on the 1st: seven days, into next year.
    expect(daysToReset(1, new Date(2026, 11, 25, 12))).toBe(7)
    expect(daysToReset(31, new Date(2026, 0, 31, 12))).toBe(0)
  })

  it("lands at the end of a month that has no 31st", () => {
    // `new Date(y, m, 31)` does not fail in February -- it rolls into March, so
    // this read fifty days instead of the eighteen to the 28th.
    expect(daysToReset(31, new Date(2026, 1, 10, 12))).toBe(18)
  })

  it("has no answer for a day that cannot exist", () => {
    expect(daysToReset(0)).toBeNull()
    expect(daysToReset(32)).toBeNull()
  })
})

describe("withHysteresis", () => {
  it("holds a level until the reading falls clear of it, and no longer", () => {
    // 91% from red: still above the exit line, so it stays red. Entering a
    // level is immediate; leaving one waits for two points of clearance.
    expect(withHysteresis(91, "danger")).toBe("danger")
    // 79% from amber: inside the hold, stays amber.
    expect(withHysteresis(79, "warn")).toBe("warn")
    // Both clear of their exit: dropped, not stepped down one tier at a time.
    expect(withHysteresis(77, "warn")).toBe("normal")
    expect(withHysteresis(50, "danger")).toBe("normal")
    // A reading that fell from red into the amber band takes amber as it is.
    expect(withHysteresis(85, "danger")).toBe("warn")
  })
})

describe("chunk", () => {
  it("splits a fleet into sixes with the remainder last", () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7, 8])).toEqual([[1, 2, 3, 4, 5, 6], [7, 8]])
    expect(chunk([1], 3)).toEqual([[1]])
    expect(chunk([])).toEqual([])
  })
})

describe("freshReadings", () => {
  it("holds a reading for five minutes and not a moment longer", () => {
    const now = 1_000_000_000
    const seen = new Map([
      [1, { q: { latency: 10, loss: 0 }, at: now - 4 * 60_000 }],
      [2, { q: { latency: null, loss: 9 }, at: now - 6 * 60_000 }],
      [3, { q: { latency: 10, loss: 0 }, at: now - 5 * 60_000 }],
    ])
    const fresh = freshReadings(seen, now)
    expect(fresh.has(1)).toBe(true)
    expect(fresh.has(2)).toBe(false)
    // Exactly five minutes is five missed cycles, not four.
    expect(fresh.has(3)).toBe(false)
  })
})

describe("sameList", () => {
  it("returns the previous array when nothing moved", () => {
    const a = [make({ id: 1 }), make({ id: 2 })]
    // The whole reason safeNodes hands back identical objects: a new array of
    // the same elements would still re-run the sort, the filter and every card.
    expect(sameList(a, [a[0], a[1]])).toBe(a)
    expect(sameList(a, a)).toBe(a)
    expect(sameList(null, a)).toBe(a)
    expect(sameList(a, [a[0]])).not.toBe(a)
    expect(sameList(a, [a[1], a[0]])).not.toBe(a)
  })
})

describe("backoffMs", () => {
  it("doubles from a second and stops at half a minute", () => {
    expect(backoffMs(0)).toBe(1000)
    expect(backoffMs(1)).toBe(2000)
    expect(backoffMs(4)).toBe(16_000)
    // Uncapped this is a fortnight: a hub down for five minutes would not be
    // retried again by a tab nobody has looked at since.
    expect(backoffMs(20)).toBe(30_000)
  })
})

describe("safeNodes", () => {
  it("mints a new object when a node stops reporting", () => {
    const first = safeNodes([make({ metrics: metrics() })])
    const gone = make({ metrics: null })
    const [after] = safeNodes([gone], new Map([[1, first[0]]]))
    // Guards `sameMetrics` being written as "if either side is missing, they
    // are the same" -- which would leave the last readings on screen forever.
    expect(after).not.toBe(first[0])
    expect(after.metrics).toBeNull()
  })
})
