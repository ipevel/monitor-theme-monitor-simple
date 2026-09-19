import { describe, expect, it } from "vitest"

import {
  axisBytes, axisTop, bytes, daysToReset, daysUntil, maskIp, pair, pc, percent, quarters, timeTicks,
} from "./format"

describe("bytes", () => {
  it("counts in 1024 while writing the short unit", () => {
    expect(bytes(1024)).toBe("1.00 KB")
    expect(bytes(1536)).toBe("1.50 KB")
    expect(bytes(1024 ** 2)).toBe("1.00 MB")
    expect(bytes(1024 ** 3)).toBe("1.00 GB")
    expect(bytes(1024 ** 4)).toBe("1.00 TB")
  })

  it("drops decimals as the number grows", () => {
    expect(bytes(1024 ** 2 * 100)).toBe("100 MB")
    expect(bytes(1024 * 15)).toBe("15.0 KB")
  })

  it("never writes a unit for nothing", () => {
    // A fraction of a byte used to index UNITS at -1 and print "512 undefined".
    expect(bytes(0)).toBe("0 B")
    expect(bytes(0.4)).toBe("0 B")
    expect(bytes(512)).toBe("512 B")
  })

  it("writes a dash for a figure that cannot be read", () => {
    // Not "0 B": a negative or NaN reading is not a claim that nothing moved.
    // On the overview strip a single unusable node poisoned the whole sum, and
    // the month read "0 B" -- which is what an idle fleet looks like.
    expect(bytes(-1)).toBe("—")
    expect(bytes(Number.NaN)).toBe("—")
    expect(bytes(Number.POSITIVE_INFINITY)).toBe("—")
  })
})

describe("pair", () => {
  it("writes a shared unit once", () => {
    expect(pair(1024, 2048)).toBe("1.00 / 2.00 GB".replace("GB", "KB"))
  })

  it("falls back when the two sides are in different units", () => {
    expect(pair(512, 1024)).toBe("512 B / 1.00 KB")
  })

  it("falls back when either side is zero", () => {
    expect(pair(0, 1024)).toBe("0 B / 1.00 KB")
  })

  /*
   * The fast path used to be the only way in that skipped `bytes()`, so the
   * figures `bytes()` refuses came out of it formatted: two Infinities share a
   * clamped unit and printed "Infinity / Infinity EB", and a sub-byte pair put
   * `unitOf` at -1 for "0.50 / 0.50 undefined".
   */
  it("falls back instead of printing an unusable pair", () => {
    expect(pair(Infinity, Infinity)).toBe("— / —")
    expect(pair(NaN, 1024)).toBe("— / 1.00 KB")
    expect(pair(1024, -1)).toBe("1.00 KB / —")
  })

  it("never reads the unit table out of bounds", () => {
    expect(pair(0.5, 0.5)).toBe("0 B / 0 B")
    expect(pair(0.5, 1024)).toBe("0 B / 1.00 KB")
  })
})

describe("axisBytes", () => {
  it("keeps one decimal inside a narrow band", () => {
    expect(axisBytes(1536)).toBe("1.5 KB")
  })

  it("trims a trailing .0 rather than repeating a label", () => {
    expect(axisBytes(1024)).toBe("1 KB")
    expect(axisBytes(2048)).toBe("2 KB")
  })

  it("drops the decimal once the number is three digits", () => {
    expect(axisBytes(1024 ** 2 * 100)).toBe("100 MB")
  })

  it("handles zero and negatives", () => {
    expect(axisBytes(0)).toBe("0 B")
    expect(axisBytes(-1)).toBe("0 B")
  })
})

describe("percent", () => {
  it("is null rather than zero when capacity is unknown", () => {
    expect(percent(null, 100)).toBeNull()
    expect(percent(50, null)).toBeNull()
    expect(percent(50, 0)).toBeNull()
  })

  it("clamps above 100", () => {
    expect(percent(50, 100)).toBe(50)
    expect(percent(150, 100)).toBe(100)
  })
})

describe("daysUntil", () => {
  const iso = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    const m = String(d.getMonth() + 1).padStart(2, "0")
    return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, "0")}`
  }

  it("returns whole days on either side of today", () => {
    expect(daysUntil(iso(1))).toBe(1)
    expect(daysUntil(iso(-1))).toBe(-1)
    expect(daysUntil(iso(30))).toBe(30)
  })

  it("is null when there is no date to read", () => {
    expect(daysUntil(null)).toBeNull()
    expect(daysUntil(undefined)).toBeNull()
    expect(daysUntil("")).toBeNull()
    expect(daysUntil("not-a-date")).toBeNull()
  })
})

describe("daysToReset", () => {
  const at = (day: number) => new Date(2026, 8, day, 12)

  it("counts forward to the reset day", () => {
    expect(daysToReset(20, at(18))).toBe(2)
  })

  it("rolls into the next month once the day has passed", () => {
    // 9 月 18 日到 10 月 1 日是 13 天。
    expect(daysToReset(1, at(18))).toBe(13)
  })

  it("is zero on the day itself", () => {
    expect(daysToReset(18, at(18))).toBe(0)
  })

  it("is null for a day the hub did not set", () => {
    expect(daysToReset(0, at(18))).toBeNull()
    expect(daysToReset(32, at(18))).toBeNull()
    expect(daysToReset(1.5, at(18))).toBeNull()
  })
})

describe("timeTicks", () => {
  it("stays inside the window and near the requested count", () => {
    const from = Date.UTC(2026, 0, 1)
    const ticks = timeTicks(from, from + 6 * 3_600_000, 8)

    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks.length).toBeLessThanOrEqual(9)
    expect(ticks[0]).toBeGreaterThanOrEqual(from)
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(from + 6 * 3_600_000)
  })

  it("spaces them evenly", () => {
    const from = Date.UTC(2026, 0, 1)
    const ticks = timeTicks(from, from + 24 * 3_600_000, 8)
    const step = ticks[1] - ticks[0]
    for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBe(step)
  })

  it("widens the step for a wider window", () => {
    const from = Date.UTC(2026, 0, 1)
    const hour = timeTicks(from, from + 3_600_000, 8)
    const week = timeTicks(from, from + 168 * 3_600_000, 8)
    expect(week[1] - week[0]).toBeGreaterThan(hour[1] - hour[0])
  })
})

describe("axisTop", () => {
  it("uses the floor so an idle host still has an axis", () => {
    expect(axisTop(0, 4, 10, 100)).toBe(4)
  })

  it("lifts to the smallest round step above the data", () => {
    expect(axisTop(37, 4, 10, 100)).toBe(40)
  })

  it("respects the cap", () => {
    expect(axisTop(20_000, 4, 10, 100)).toBe(100)
  })

  it("stays round in binary units", () => {
    const mib = 1024 ** 2
    expect(axisTop(2 * mib, 1024, 1024)).toBe(2 * mib)
    // 一次幂以上不落回 10 倍步长，第三根网格线也必须落在能打印的标签上。
    expect(axisTop(1.5 * mib, 1024, 1024)).toBe(2 * mib)
  })
})

describe("quarters", () => {
  it("returns the top and its three quarters", () => {
    expect(quarters(100)).toEqual([0, 25, 50, 75, 100])
  })
})

describe("pc", () => {
  /**
   * One format for the whole panel. The card kept a decimal below ten and the
   * detail page did not, so a host at 7.5% read "7.5%" on its card and "8%"
   * once opened -- the same reading, two values.
   */
  it("keeps one decimal below ten and none above", () => {
    expect(pc(7.5)).toBe("7.5%")
    expect(pc(9.94)).toBe("9.9%")
    expect(pc(10)).toBe("10%")
    expect(pc(88.4)).toBe("88%")
  })

  it("has a form for a reading that is not there", () => {
    expect(pc(null)).toBe("—")
    expect(pc(Number.NaN)).toBe("—")
    expect(pc(Number.POSITIVE_INFINITY)).toBe("—")
  })
})

describe("maskIp", () => {
  /**
   * This is a public probe page: whatever prints here prints for anyone who
   * loads the URL. The prefix survives because "which network" is what triage
   * needs; the rest is the host, and that is what is being kept.
   */
  it("keeps an IPv4 network and hides the host", () => {
    expect(maskIp("203.0.113.47")).toBe("203.0.*.*")
    expect(maskIp(" 10.0.0.1 ")).toBe("10.0.*.*")
  })

  it("keeps the first two groups of an IPv6 address", () => {
    expect(maskIp("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8::*")
  })

  it("does not invent a prefix out of the empty groups in a loopback", () => {
    expect(maskIp("::1")).toBe("*")
  })

  it("leaves a value it cannot parse alone rather than truncating it", () => {
    expect(maskIp("host.example.internal")).toBe("host.example.internal")
    expect(maskIp("")).toBe("")
  })
})
