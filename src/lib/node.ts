import type { Node } from "@/lib/api"
import { percent } from "@/lib/format"
import { withHysteresis, type Severity } from "@/lib/severity"

/**
 * Billable traffic for the current cycle.
 *
 * The hub computes this itself and sends it beside the two directions, and its
 * figure is the one the panel, the traffic alert and the notification all read.
 * It wins wherever it is present: two implementations of "what counts against
 * the allowance" are two places for the definition to move apart, and the
 * disagreement would surface as a card whose number does not match the alert
 * that was sent about it.
 *
 * The sum below is what remains for a hub older than the field. Both directions
 * are reported there with a mode saying which one counts -- an upstream-only or
 * downstream-only plan is billed on one direction, `max` on whichever is larger
 * -- and summing blindly would overstate those plans. The number is what the
 * traffic bar and the "this month" sort read, so it has to match what the
 * provider charges for.
 */
export function monthUsage(node: Node): number {
  const { month_used: billed } = node
  if (typeof billed === "number" && Number.isFinite(billed)) return billed
  const { month_rx: rx, month_tx: tx } = node
  switch (node.traffic_mode) {
    case "up": return tx
    case "down": return rx
    case "max": return Math.max(rx, tx)
    default: return rx + tx
  }
}

/** Whether an agent has ever reported hardware for this node. */
export function deployed(node: Node): boolean {
  return node.cpu_cores > 0 || node.mem_total > 0
}

/**
 * Five states, not three.
 *
 * `metrics: null` on an online node used to be collapsed into the same rendering
 * as malformed metrics -- both drew "online" beside a column of dashes. They
 * call for different things: one is an agent that has not sent its first sample
 * yet and needs a moment, the other is data that cannot be trusted and needs
 * saying so.
 */
export type Health = "ok" | "pending" | "invalid" | "offline" | "unconnected"

/**
 * The single source of truth for what a node currently looks like. The card's
 * status line, its body and the filter counts all read this, so an agent that
 * has connected but not yet reported cannot end up described as "connected,
 * waiting" in one place and "not set up yet" in another.
 *
 * Deliberately a function of the payload alone -- no clock. Freshness is a
 * separate question, answered by `stale()` below, because mixing it in here
 * would make every filter and count drift between renders without any data
 * having changed.
 */
export function health(node: Node): Health {
  if (!node.online) return deployed(node) ? "offline" : "unconnected"
  if (node.metrics) return "ok"
  return node.metrics_invalid ? "invalid" : "pending"
}

/**
 * Load as a share of the machine's cores.
 *
 * `load[0]` is a raw one-minute average: 1.6 says nothing until you know whether
 * the box has two cores or sixteen. Divided by the core count it becomes a
 * saturation figure the same 80/92 thresholds can read, which is the point --
 * a two-core host at load 20 is in trouble with a CPU sample that happens to
 * read 8%.
 */
export function loadPercent(node: Node): number | null {
  const load = node.metrics?.load?.[0]
  const cores = node.cpu_cores
  if (load === null || load === undefined || !(cores > 0)) return null
  return (load / cores) * 100
}

/** Swap in use. Containers without swap report no total and have no ratio. */
export function swapPercent(node: Node): number | null {
  const m = node.metrics
  if (!m || !m.swap_total || m.swap_total <= 0) return null
  return percent(m.swap_used, m.swap_total)
}

/**
 * Each node's memory of the level its readings last held, for the hysteresis
 * in `withHysteresis`. Keyed by node id: `safeNodes` mints a fresh metrics
 * object whenever a value moves, so keying on the object would forget exactly
 * when the reading is bouncing. A node that leaves the fleet leaves one small
 * entry behind; the cap exists so a churning fleet cannot grow it unbounded.
 */
const hysteresis = new Map<number, Severity[]>()

/**
 * The worst reading on a node, across everything the panel is willing to alert
 * on.
 *
 * The three big numbers are not the whole story. Load and swap were both in the
 * payload and neither reached a threshold, so a host thrashing its swap or
 * pinned at twenty times its core count drew three grey figures and a green
 * dot -- the panel's one job is to make that impossible.
 */
export function worstSeverity(node: Node): Severity {
  const m = node.metrics
  if (!m || health(node) !== "ok") {
    // No readings, no memory: a host that comes back after a reboot starts
    // from the thresholds themselves, not from whatever it held before it
    // went away.
    hysteresis.delete(node.id)
    return "normal"
  }
  const raw = [
    m.cpu,
    percent(m.mem_used, m.mem_total),
    percent(m.disk_used, m.disk_total),
    loadPercent(node),
    swapPercent(node),
  ]
  const prev = hysteresis.get(node.id) ?? []
  const levels = raw.map((pct, i) => withHysteresis(pct, prev[i] ?? "normal"))
  if (hysteresis.size > 4096) {
    /*
     * Map iterates in insertion order, so the head of this loop is the oldest
     * quarter of the fleet's memory -- hosts that left the list, mostly.
     * Clearing wholesale (what this used to do) reset hysteresis for every
     * host at once, and a fleet idling on the 80% boundary would re-announce
     * together in the same tick.
     */
    let drop = hysteresis.size - 3072
    for (const key of hysteresis.keys()) {
      if (drop-- <= 0) break
      hysteresis.delete(key)
    }
  }
  hysteresis.set(node.id, levels)
  return levels.includes("danger") ? "danger" : levels.includes("warn") ? "warn" : "normal"
}

/**
 * Three pushes at a 2 s cadence, with slack. Past this the numbers on screen
 * are no longer being updated.
 */
export const STALE_AFTER = 120

/**
 * Seconds since the agent last reported, once that is too long to be normal.
 *
 * `online` is the hub's own flag and it lags behind the agent. When it does, the
 * card goes on showing a full set of live-looking figures that stopped moving --
 * the exact failure this panel exists to catch, dressed as a healthy node. The
 * reading is kept, but it stops claiming to be current.
 */
export function stale(node: Node): number | null {
  if (!node.last_seen) return null
  const age = Date.now() / 1000 - node.last_seen
  return age > STALE_AFTER ? age : null
}

/**
 * Whether a node is asking to be looked at, and how loudly.
 *
 * Three things count: a reading past its threshold, a reading that stopped
 * arriving, and data that cannot be trusted. An `invalid` node already draws
 * its card red, so the count and the filter must be able to find it too --
 * leaving it out was how the strip said "无" while a red card sat in the grid.
 * Offline nodes are still not included -- the fleet tile names how many are
 * down and they have a filter of their own, so folding them in here would
 * report one problem twice under a heading that means "utilisation".
 *
 * Shared by the overview tile, the filter chip and the card's rail so the count,
 * the list it opens and the mark on each card can never disagree.
 */
/**
 * The one judgement, written once.
 *
 * There were two copies of it: this one for the count and the filter, and one
 * inside the card for the rail down its edge. They agreed on everything except
 * offline -- the rail counts a down host as the loudest thing on the page, the
 * count does not, because the fleet tile numbers the down hosts separately and
 * counting them twice would mean two tiles reporting one problem.
 *
 * Two copies of "how loud is this host" is two places to change a threshold in,
 * and one of them eventually gets forgotten. The difference is now a parameter
 * rather than a second implementation.
 */
function level(node: Node, state: Health, aged: number | null, offlineIsDanger: boolean): Severity {
  if (state === "invalid") return "danger"
  if (state === "offline") return offlineIsDanger ? "danger" : "normal"
  if (state !== "ok") return "normal"
  const readings = worstSeverity(node)
  if (readings !== "normal") return readings
  return (aged ?? stale(node)) !== null ? "warn" : "normal"
}

export function alertLevel(node: Node): Severity {
  return level(node, health(node), null, false)
}

/** What the card's rail reports: a host that is down is the loudest thing in the grid. */
export function railLevel(node: Node, state: Health, aged: number | null): Severity {
  return level(node, state, aged, true)
}
