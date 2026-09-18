import type { Node } from "@/lib/api"
import { percent } from "@/lib/format"
import { severity, type Severity } from "@/lib/severity"

/**
 * Billable traffic for the current cycle.
 *
 * The hub reports both directions and a mode saying which one counts: an
 * upstream-only or downstream-only plan is billed on one direction, `max` on
 * whichever is larger. Summing blindly would overstate those plans, and the
 * number is what the traffic bar and the "this month" sort read, so it has to
 * match what the provider charges for.
 */
export function monthUsage(node: Node): number {
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
  if (!m || health(node) !== "ok") return "normal"
  const levels = [
    severity(m.cpu),
    severity(percent(m.mem_used, m.mem_total)),
    severity(percent(m.disk_used, m.disk_total)),
    severity(loadPercent(node)),
    severity(swapPercent(node)),
  ]
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
 * Two things count, and they are the two things this panel is for: a reading
 * past its threshold, and a reading that stopped arriving. Offline nodes are not
 * included -- the fleet tile names how many are down and they have a filter of
 * their own, so folding them in here would report one problem twice under a
 * heading that means "utilisation".
 *
 * Shared by the overview tile, the filter chip and the card's rail so the count,
 * the list it opens and the mark on each card can never disagree.
 */
export function alertLevel(node: Node): Severity {
  if (health(node) !== "ok") return "normal"
  const readings = worstSeverity(node)
  if (readings !== "normal") return readings
  return stale(node) !== null ? "warn" : "normal"
}
