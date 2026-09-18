import { useEffect, useMemo, useState } from "react"

import { api, type Node } from "@/lib/api"

export type Quality = { latency: number | null; loss: number }

type PingPoint = { task_id: string; ts: number; latency: number | null }
type Payload = { ping: PingPoint[]; loss?: Record<string, number> }

/**
 * Latency and loss, one row per node.
 *
 * These sit on a different endpoint from the node list and cannot ride along
 * with the two-second push: the list snapshot carries no ping at all, and adding
 * a column would mean thirteen extra requests on every tick. So they are behind
 * a switch that starts off -- the panel's job is utilisation, and a host that is
 * healthy on CPU can still be unreachable, which is exactly the case this row
 * exists to make visible when someone goes looking for it.
 *
 * Refreshed on a minute rather than the push cadence: a probe result changes on
 * the order of minutes, and the point of the row is a standing condition, not a
 * live graph. `points=60` over one hour is enough for a latest reading and a
 * loss ratio without asking the hub to aggregate a week of samples per node.
 */
const REFRESH_MS = 60_000
const WINDOW_HOURS = 1

/** Shared empty result: a stable identity keeps the cards from re-rendering. */
const NOTHING: Map<number, Quality> = new Map()

export function useNetworkQuality(enabled: boolean, nodes: Node[] | null): Map<number, Quality> {
  /**
   * Keyed on the set of node ids, not on the array.
   *
   * The list is a fresh array on every push that moves any reading -- on a live
   * fleet, every two seconds -- so an effect depending on it would tear down and
   * re-run on each tick, firing thirteen history requests twice a second instead
   * of thirteen a minute. The ids are what this hook actually needs; a node
   * added or removed is the only thing that should restart it.
   */
  const key = nodes?.map((n) => n.id).join(",") ?? ""
  const ids = useMemo(() => (key ? key.split(",").map(Number) : []), [key])
  const active = enabled && ids.length > 0

  const [quality, setQuality] = useState<Map<number, Quality>>(NOTHING)

  useEffect(() => {
    if (!active) return

    let alive = true

    const load = () => {
      void Promise.all(
        ids.map(async (id) => {
          try {
            const payload = await api<Payload>(
              `/nodes/${id}/metrics?hours=${WINDOW_HOURS}&points=60&series=ping`,
            )
            const timed = (payload.ping ?? []).filter((p) => p.latency !== null)
            const latency = timed.length > 0 ? timed[timed.length - 1].latency : null
            // The response-level figure, never an average over the sample rows:
            // the buckets hold different sample counts, and averaging them is
            // how a working link reports 50% loss.
            const losses = Object.values(payload.loss ?? {})
            const loss = losses.length > 0 ? Math.max(...losses) : 0
            return [id, { latency, loss }] as const
          } catch {
            // A node that cannot be probed gets no row rather than a row of
            // dashes; its card is already saying enough about it.
            return null
          }
        }),
      ).then((rows) => {
        if (!alive) return
        // Rebuilt from scratch every minute, so a node whose probe starts
        // failing loses its row rather than keeping the last reading it managed.
        setQuality(new Map(rows.filter((row) => row !== null)))
      })
    }

    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [active, ids])

  /**
   * Discarded at read time rather than cleared in the effect.
   *
   * Clearing would mean setting state synchronously from the effect, which is a
   * second render pass on every toggle for the same result. What matters is that
   * a reading taken while the switch was on never stands behind a closed switch:
   * its age is not visible, so nobody could tell it apart from a live one. The
   * window while it is switched on is one request round-trip -- and every cycle
   * rebuilds the whole map, so a reading cannot freeze there.
   */
  return active ? quality : NOTHING
}

/**
 * Where a loss ratio starts to mean something. Below the first tier an ordinary
 * home line's occasional dropped packet is not worth a colour; above the second
 * the link is unusable for anything real.
 */
export const LOSS_WARN = 5
export const LOSS_DANGER = 15
