import { describe, expect, it } from "vitest"

import type { Metrics, Node } from "@/lib/api"
import { alertLevel, health, loadPercent, stale, STALE_AFTER, swapPercent, worstSeverity } from "@/lib/node"

const metrics = (over: Partial<Metrics> = {}): Metrics => ({
  uptime: 90000,
  cpu: 8,
  load: [0.4, 0.5, 0.6],
  mem_total: 4 * 1024 ** 3,
  mem_used: 1024 ** 3,
  swap_total: 2 * 1024 ** 3,
  swap_used: 0,
  disk_total: 100 * 1024 ** 3,
  disk_used: 20 * 1024 ** 3,
  net_rx: 1024,
  net_tx: 512,
  total_rx: 1024 ** 3,
  total_tx: 1024 ** 3,
  month_rx: 10 * 1024 ** 3,
  month_tx: 5 * 1024 ** 3,
  tcp: 40,
  udp: 6,
  procs: 120,
  ...over,
})

const node = (over: Partial<Node> = {}): Node => ({
  id: 1,
  name: "node-1",
  sort: 1,
  public: true,
  online: true,
  country: "JP",
  last_seen: Math.floor(Date.now() / 1000),
  metrics: metrics(),
  os: "Debian",
  kernel: "6.8.0",
  arch: "x86_64",
  virt: "kvm",
  cpu_name: "Ryzen",
  cpu_cores: 2,
  mem_total: 4 * 1024 ** 3,
  swap_total: 2 * 1024 ** 3,
  disk_total: 100 * 1024 ** 3,
  agent_version: "1.0.0",
  price: 5,
  currency: "USD",
  billing_cycle: "monthly",
  expires_at: null,
  traffic_limit: 500 * 1024 ** 3,
  traffic_mode: "sum",
  traffic_reset_day: 1,
  total_rx: 1024 ** 3,
  total_tx: 1024 ** 3,
  month_rx: 10 * 1024 ** 3,
  month_tx: 5 * 1024 ** 3,
  month_start: "2026-09-01",
  day_rx: 1024,
  day_tx: 512,
  ...over,
})

describe("loadPercent", () => {
  it("reads a load average against the core count", () => {
    // The whole point of the division: 20 is fatal on two cores and unremarkable
    // on thirty-two, and the raw figure cannot tell them apart.
    expect(loadPercent(node({ cpu_cores: 2, metrics: metrics({ load: [20, 20, 20] }) }))).toBe(1000)
    expect(loadPercent(node({ cpu_cores: 4, metrics: metrics({ load: [2, 2, 2] }) }))).toBe(50)
  })

  it("has no ratio without both a load average and a core count", () => {
    // A container report with no `load` at all, and an agent that never said how
    // many cores it has -- neither is a reading of 0%.
    expect(loadPercent(node({ metrics: metrics({ load: null }) }))).toBeNull()
    expect(loadPercent(node({ metrics: null }))).toBeNull()
    expect(loadPercent(node({ cpu_cores: 0 }))).toBeNull()
  })
})

describe("swapPercent", () => {
  it("needs a swap total, which containers do not report", () => {
    expect(swapPercent(node({ metrics: metrics({ swap_total: 0, swap_used: 0 }) }))).toBeNull()
    expect(swapPercent(node({ metrics: null }))).toBeNull()
  })

  it("reports usage as a share of the total", () => {
    const m = metrics({ swap_total: 2 * 1024 ** 3, swap_used: 1.7 * 1024 ** 3 })
    expect(swapPercent(node({ metrics: m }))).toBeCloseTo(85, 5)
  })
})

describe("worstSeverity", () => {
  it("catches the two readings that used to stay grey", () => {
    // Each of these drew three comfortable figures and a green dot: the CPU
    // sample is genuinely low in both cases, and neither load nor swap reached a
    // threshold before.
    const pinned = node({ id: 61, cpu_cores: 2, metrics: metrics({ cpu: 8, load: [20, 20, 20] }) })
    expect(worstSeverity(pinned)).toBe("danger")

    const thrashing = node({ id: 62, metrics: metrics({ cpu: 8, swap_used: 1.7 * 1024 ** 3 }) })
    expect(worstSeverity(thrashing)).toBe("warn")
  })

  it("takes the loudest of the five readings", () => {
    const m = metrics({ cpu: 95, mem_used: 3.9 * 1024 ** 3 })
    expect(worstSeverity(node({ id: 63, metrics: m }))).toBe("danger")
  })

  it("stays out of the way for a healthy node and for one not reporting", () => {
    expect(worstSeverity(node({ id: 64 }))).toBe("normal")
    // A node with nothing to read has no severity -- claiming one would put an
    // offline host in the alert count.
    expect(worstSeverity(node({ id: 65, online: false }))).toBe("normal")
    expect(worstSeverity(node({ id: 66, metrics: null }))).toBe("normal")
  })

  it("holds a level until the reading clearly falls below it", () => {
    // A host hovering at the line crossed it on every two-second push and the
    // problem-first sort reshuffled the grid each time. Entering a level is
    // immediate; leaving it waits for a two-point margin.
    expect(worstSeverity(node({ id: 71, metrics: metrics({ cpu: 85 }) }))).toBe("warn")
    expect(worstSeverity(node({ id: 71, metrics: metrics({ cpu: 79.5 }) }))).toBe("warn")
    expect(worstSeverity(node({ id: 71, metrics: metrics({ cpu: 77 }) }))).toBe("normal")
  })

  it("walks down the ladder without flickering at either rung", () => {
    expect(worstSeverity(node({ id: 72, metrics: metrics({ cpu: 95 }) }))).toBe("danger")
    expect(worstSeverity(node({ id: 72, metrics: metrics({ cpu: 91 }) }))).toBe("danger")
    expect(worstSeverity(node({ id: 72, metrics: metrics({ cpu: 89 }) }))).toBe("warn")
    expect(worstSeverity(node({ id: 72, metrics: metrics({ cpu: 79 }) }))).toBe("warn")
  })

  it("forgets the hold once the node stops reporting", () => {
    // A reboot is a fresh reading history: coming back at 70% must not stand
    // behind an amber it earned before it went away.
    expect(worstSeverity(node({ id: 73, metrics: metrics({ cpu: 85 }) }))).toBe("warn")
    expect(worstSeverity(node({ id: 73, online: false }))).toBe("normal")
    expect(worstSeverity(node({ id: 73, metrics: metrics({ cpu: 70 }) }))).toBe("normal")
  })
})

describe("stale", () => {
  const ago = (seconds: number) => Math.floor(Date.now() / 1000) - seconds

  it("is quiet while reports are arriving", () => {
    expect(stale(node({ last_seen: ago(3) }))).toBeNull()
    expect(stale(node({ last_seen: ago(STALE_AFTER - 1) }))).toBeNull()
  })

  it("reports the age once the agent has gone quiet", () => {
    // `online` is the hub's flag and it lags: the reading is still shown, but it
    // stops claiming to be current. Whole seconds, so the age lands on 300 flat
    // or just past it.
    const age = stale(node({ last_seen: ago(300) }))
    expect(age).toBeGreaterThanOrEqual(300)
    expect(age).toBeLessThan(301)
  })

  it("has no opinion when the field is absent or zero", () => {
    expect(stale(node({ last_seen: 0 }))).toBeNull()
  })
})

describe("alertLevel", () => {
  it("counts a threshold and a silence, but not a host that is down", () => {
    // Offline hosts are named on their own tile and have their own filter;
    // folding them in here would report one problem twice under a heading that
    // means "utilisation".
    expect(alertLevel(node({ id: 81, online: false }))).toBe("normal")
    expect(alertLevel(node({ id: 82, metrics: null }))).toBe("normal")
    expect(alertLevel(node({ id: 83 }))).toBe("normal")
  })

  it("counts an unreadable node, whose card already draws red", () => {
    // The strip used to say 无 while a red card sat in the grid, and the alert
    // filter could not find it: the state was an alert everywhere except in
    // the one place the count is read.
    expect(alertLevel(node({ id: 84, metrics: null, metrics_invalid: true }))).toBe("danger")
  })

  it("carries the reading's severity through", () => {
    expect(alertLevel(node({ id: 85, metrics: metrics({ cpu: 85 }) }))).toBe("warn")
    expect(alertLevel(node({ id: 86, metrics: metrics({ cpu: 95 }) }))).toBe("danger")
  })

  it("treats a quiet agent as an alert even when every reading is fine", () => {
    const silent = node({ id: 87, last_seen: Math.floor(Date.now() / 1000) - 600 })
    expect(health(silent)).toBe("ok")
    expect(alertLevel(silent)).toBe("warn")
  })
})

describe("hysteresis memory", () => {
  /*
   * The cap used to clear the whole map, which reset hysteresis for every host
   * in the fleet at once: a few hundred machines idling on the 80% boundary
   * would all re-announce in the same tick. Dropping the oldest quarter is the
   * same bound with a local cost.
   */
  it("drops the oldest entries rather than clearing the map", () => {
    const oldest = 1
    const newest = 4200
    for (let i = 1; i <= newest; i++) {
      worstSeverity(node({ id: i, metrics: metrics({ cpu: 95 }) }))
    }
    /*
     * 91 sits below the 92 danger line but above the 90 line at which danger
     * is released. A host that remembers being red stays red on that number;
     * one whose memory was dropped reads it for what it now is -- amber. The
     * difference is the whole point: `clear()` would have put every host in
     * the fleet back on the raw thresholds in one tick.
     */
    expect(worstSeverity(node({ id: newest, metrics: metrics({ cpu: 91 }) }))).toBe("danger")
    expect(worstSeverity(node({ id: oldest, metrics: metrics({ cpu: 91 }) }))).toBe("warn")
  })
})
