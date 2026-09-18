import type { Node } from "@/lib/api"

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
 */
export function health(node: Node): Health {
  if (!node.online) return deployed(node) ? "offline" : "unconnected"
  if (node.metrics) return "ok"
  return node.metrics_invalid ? "invalid" : "pending"
}
