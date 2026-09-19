import { describe, expect, it } from "vitest"

import { ApiError, friendly, isMe, safeMetrics, safeNodes, type Metrics, type Node } from "./api"

/**
 * These two functions are the whole data layer's contract: everything the five
 * card states say, and whether a card can be memoised at all, is decided here.
 * A field-cleanliness regression used to surface three screens away, as a
 * wrong label or a re-render storm, with nothing pointing back at this file.
 */

const node = (over: Partial<Node> = {}): Node => ({
  id: 1,
  name: "node-1",
  sort: 1,
  public: true,
  online: true,
  country: "JP",
  last_seen: 1,
  metrics: {
    uptime: 90_000,
    cpu: 8,
    load: [0.4, 0.5, 0.6],
    mem_total: 4 * 1024 ** 3,
    mem_used: 1024 ** 3,
    swap_total: 0,
    swap_used: 0,
    disk_total: 100 * 1024 ** 3,
    disk_used: 20 * 1024 ** 3,
    net_rx: 1024,
    net_tx: 512,
    total_rx: 0,
    total_tx: 0,
    month_rx: 0,
    month_tx: 0,
    tcp: 40,
    udp: 6,
    procs: 120,
  },
  os: "Debian",
  kernel: "6.8.0",
  arch: "x86_64",
  virt: "kvm",
  cpu_name: "Ryzen",
  cpu_cores: 2,
  mem_total: 4 * 1024 ** 3,
  swap_total: 0,
  disk_total: 100 * 1024 ** 3,
  agent_version: "1.0.0",
  price: 5,
  currency: "USD",
  billing_cycle: "monthly",
  expires_at: null,
  traffic_limit: 0,
  traffic_mode: "sum",
  traffic_reset_day: 1,
  total_rx: 0,
  total_tx: 0,
  month_rx: 0,
  month_tx: 0,
  month_start: "2026-09-01",
  day_rx: 0,
  day_tx: 0,
  ...over,
})

describe("safeMetrics", () => {
  it("reads an absent payload as nothing to say, not as a broken one", () => {
    // "Connected, has not reported yet" is ordinary; only an unreadable
    // payload means the data cannot be trusted.
    expect(safeMetrics(null)).toEqual({ metrics: null, invalid: false })
    expect(safeMetrics(undefined)).toEqual({ metrics: null, invalid: false })
  })

  it("marks a payload that is not an object at all as invalid", () => {
    expect(safeMetrics("junk")).toEqual({ metrics: null, invalid: true })
    expect(safeMetrics(42)).toEqual({ metrics: null, invalid: true })
  })

  it("keeps a card alive when one field is malformed", () => {
    // NaN, a negative and a string each become null and render as "—"; the
    // rest of the reading is worth keeping.
    const { metrics, invalid } = safeMetrics({
      cpu: Number.NaN,
      mem_used: -5,
      disk_used: "high",
      mem_total: 4 * 1024 ** 3,
      disk_total: 100 * 1024 ** 3,
      uptime: 90_000,
    })
    expect(invalid).toBe(false)
    expect(metrics?.cpu).toBeNull()
    expect(metrics?.mem_used).toBeNull()
    expect(metrics?.disk_used).toBeNull()
    expect(metrics?.mem_total).toBe(4 * 1024 ** 3)
    expect(metrics?.uptime).toBe(90_000)
  })

  it("discards the object only when no core field can be read", () => {
    // A truncated response still carrying `uptime` is not a set of metrics.
    const only = safeMetrics({ uptime: 90_000 })
    expect(only).toEqual({ metrics: null, invalid: true })

    const { metrics, invalid } = safeMetrics({ cpu: 8, mem_total: 1024 })
    expect(invalid).toBe(false)
    expect(metrics?.cpu).toBe(8)
  })

  it("checks the load tuple for shape, not just for presence", () => {
    const good = safeMetrics({ cpu: 8, load: [1, 2, 3] })
    expect(good.metrics?.load).toEqual([1, 2, 3])

    // Two values, or one unreadable member, and the whole tuple is out --
    // a partial average rendered as three numbers would be worse than none.
    expect(safeMetrics({ cpu: 8, load: [1, 2] }).metrics?.load).toBeNull()
    expect(safeMetrics({ cpu: 8, load: [1, "x", 3] }).metrics?.load).toBeNull()
    expect(safeMetrics({ cpu: 8, load: "0.4 0.5 0.6" }).metrics?.load).toBeNull()
  })
})

describe("safeNodes", () => {
  it("flags a node whose metrics are unusable and blanks them", () => {
    const [n] = safeNodes([node({ metrics: "junk" as unknown as Metrics })])
    expect(n.metrics).toBeNull()
    expect(n.metrics_invalid).toBe(true)
  })

  it("drops the flag once the agent reports something readable again", () => {
    const first = safeNodes([node({ metrics: "junk" as unknown as Metrics })])
    const next = node({ id: first[0].id, metrics: node({ id: first[0].id }).metrics })
    const [recovered] = safeNodes([next], new Map([[first[0].id, first[0]]]))
    expect(recovered.metrics_invalid).toBeUndefined()
    expect(recovered.metrics?.cpu).toBe(8)
  })

  it("hands back the same object when nothing moved", () => {
    // The whole memoisation story rests on this: a fleet at rest re-parses
    // into fresh JSON trees twice a second, and without identity reuse every
    // card would re-render whether or not a number changed.
    const first = safeNodes([node()])
    const again = safeNodes([node()], new Map([[1, first[0]]]))
    expect(again[0]).toBe(first[0])
  })

  it("mints a new object when any field moves", () => {
    const first = safeNodes([node()])
    const moved = safeNodes([node({ cpu_cores: 4 })], new Map([[1, first[0]]]))
    expect(moved[0]).not.toBe(first[0])
    expect(moved[0].cpu_cores).toBe(4)

    const movedMetrics = safeNodes([node({ metrics: node().metrics }) ], new Map([[1, first[0]]]))
    const bumped = structuredClone(node())
    bumped.metrics = { ...(bumped.metrics as Metrics), cpu: 9 }
    const third = safeNodes([bumped], new Map([[1, movedMetrics[0]]]))
    expect(third[0]).not.toBe(movedMetrics[0])
    expect(third[0].metrics?.cpu).toBe(9)
  })

  it("sees a field appear that the previous payload did not carry", () => {
    // An authenticated reply adds keys a public one lacks; comparing only the
    // new object's own keys would miss exactly that transition.
    const first = safeNodes([node()])
    const withIp = safeNodes([node({ ip: "203.0.113.7" })], new Map([[1, first[0]]]))
    expect(withIp[0]).not.toBe(first[0])
    expect(withIp[0].ip).toBe("203.0.113.7")
  })
})

/*
 * A hub field arriving as the wrong primitive used to throw inside render --
 * `country.toLowerCase()` on a number, `price.toFixed` on a string -- and
 * there is no error boundary, so one bad field took the whole panel with it.
 */
describe("safeNodes, for text and money fields", () => {
  it("coerces text fields so string operations cannot throw", () => {
    const bad = node({ name: 12 as unknown as string, country: 86 as unknown as string })
    const clean = safeNodes([bad])[0]
    expect(clean.name).toBe("12")
    expect(clean.country).toBe("86")
    expect(clean.country.toLowerCase()).toBe("86")
    expect(clean.country.trim()).toBe("86")
  })

  it("turns a missing or unusable price into zero, not a string sum", () => {
    expect(safeNodes([node({ price: "5" as unknown as number })])[0].price).toBe(0)
    expect(safeNodes([node({ price: Number.NaN })])[0].price).toBe(0)
    expect(safeNodes([node({ price: 12.5 })])[0].price).toBe(12.5)
  })

  it("leaves the identity reuse intact when a field had to be coerced", () => {
    const first = safeNodes([node({ country: 86 as unknown as string })])
    const again = safeNodes([node({ country: 86 as unknown as string })], new Map([[1, first[0]]]))
    expect(again[0]).toBe(first[0])
  })
})

describe("isMe", () => {
  /**
   * `api<T>` checks nothing at run time, and the one decision hanging off this
   * response is a redirect to /admin/. A `/me` that arrives without the field
   * reads as "not public", which is the answer that throws a visitor out of a
   * public page.
   */
  it("accepts a response it can read", () => {
    expect(isMe({ public_page: true, authed: false })).toBe(true)
    expect(isMe({ authed: true })).toBe(true)
  })

  it("rejects the shapes that would have been read as 'not public'", () => {
    expect(isMe({})).toBe(false)
    expect(isMe({ site_name: "x" })).toBe(false)
    expect(isMe(null)).toBe(false)
    expect(isMe("null")).toBe(false)
  })
})

describe("friendly", () => {
  /**
   * `e.message` was printed on the page in four places, and `e.message` is
   * whatever the other end sent. None of these leak anything, and none of them
   * is a stack line.
   */
  it("speaks in sentences a visitor can act on", () => {
    expect(friendly(new ApiError(401, "unauthorized"))).toBe("登录状态已失效")
    expect(friendly(new ApiError(403, "forbidden"))).toBe("登录状态已失效")
    expect(friendly(new ApiError(500, "boom"))).toBe("服务暂时不可用")
    expect(friendly(new ApiError(404, "missing"))).toBe("接口不存在")
  })

  it("never passes an unknown message through", () => {
    expect(friendly(new Error("unexpected end of JSON input"))).toBe("网络错误")
    expect(friendly(new TypeError("Failed to fetch"))).toBe("网络错误")
    expect(friendly(undefined)).toBe("网络错误")
  })
})

describe("safeNodes", () => {
  it("gives the text fields it prints a value they can print", () => {
    const [clean] = safeNodes([node({
      billing_cycle: undefined as unknown as string,
      currency: undefined as unknown as string,
      remark: undefined as unknown as string,
    })])
    // `CYCLES[undefined]` printed an empty renewal period and
    // `money(price, undefined)` printed "undefined" where the symbol goes.
    expect(clean.billing_cycle).toBe("")
    expect(clean.currency).toBe("")
    expect(clean.remark).toBe("")
  })

  it("does not invent host details a public visitor was never sent", () => {
    expect(safeNodes([node()])[0].ip).toBe("")
    expect(safeNodes([node({ ip: "203.0.113.47" })])[0].ip).toBe("203.0.113.47")
  })
})
