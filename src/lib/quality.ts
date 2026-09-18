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
 * a column would mean one extra request per node on every tick. So they are
 * behind a switch that starts off -- the panel's job is utilisation, and a host
 * that is healthy on CPU can still be unreachable, which is exactly the case
 * this row exists to make visible when someone goes looking for it.
 *
 * Refreshed on a minute rather than the push cadence: a probe result changes on
 * the order of minutes, and the point of the row is a standing condition, not a
 * live graph. `points=60` over one hour is enough for a latest reading and a
 * loss ratio without asking the hub to aggregate a week of samples per node.
 */
const REFRESH_MS = 60_000
const WINDOW_HOURS = 1

/**
 * Requests go out in chunks, not as one burst.
 *
 * A fleet of dozens means dozens of simultaneous requests against one small
 * endpoint: the browser queues them six at a time over HTTP/1.1 and the hub may
 * shed load under the spike, so a share of nodes loses its reading every cycle
 * -- which read as "some cards have the row and some never do". Six in flight
 * finishes a fifty-node fleet in a few seconds and never trips either limit.
 */
const CHUNK = 6

/** One quiet retry for a chunk that failed, before waiting a full minute. */
const RETRY_MS = 3_000

/**
 * How long a reading is trusted after it was taken.
 *
 * A failed request keeps last cycle's reading instead of blanking the card:
 * one dropped round-trip says nothing about the probe, and a row that
 * flickers away and back reads as a bug. Five minutes is five consecutive
 * missed cycles -- past that the row is dropped, so a dead endpoint cannot
 * stand behind a number nobody can see the age of.
 */
const HOLD_MS = 5 * 60_000

/** Shared empty result: a stable identity keeps the cards from re-rendering. */
const NOTHING: Map<number, Quality> = new Map()

/**
 * Latest latency and worst-bucket loss from one ping payload.
 *
 * The response-level loss figure, never an average over the sample rows: the
 * buckets hold different sample counts, and averaging them is how a working
 * link reports 50% loss.
 */
export function parsePing(payload: Payload): Quality {
  const timed = (payload.ping ?? []).filter((p) => p.latency !== null)
  const latency = timed.length > 0 ? timed[timed.length - 1].latency : null
  const losses = Object.values(payload.loss ?? {})
  const loss = losses.length > 0 ? Math.max(...losses) : 0
  return { latency, loss }
}

export function useNetworkQuality(enabled: boolean, nodes: Node[] | null): Map<number, Quality> {
  /**
   * Keyed on the set of node ids, not on the array.
   *
   * The list is a fresh array on every push that moves any reading -- on a live
   * fleet, every two seconds -- so an effect depending on it would tear down and
   * re-run on each tick, firing one history request per node twice a second
   * instead of per node a minute. The ids are what this hook actually needs; a
   * node added or removed is the only thing that should restart it.
   */
  const key = nodes?.map((n) => n.id).join(",") ?? ""
  const ids = useMemo(() => (key ? key.split(",").map(Number) : []), [key])
  const active = enabled && ids.length > 0

  const [quality, setQuality] = useState<Map<number, Quality>>(NOTHING)

  useEffect(() => {
    if (!active) return

    let alive = true
    let running = false

    /** Last good reading per node, with the time it was taken. */
    const seen = new Map<number, { q: Quality; at: number }>()

    const publish = () => {
      if (!alive) return
      const now = Date.now()
      const fresh = new Map<number, Quality>()
      for (const [id, entry] of seen) {
        if (now - entry.at < HOLD_MS) fresh.set(id, entry.q)
      }
      setQuality(fresh)
    }

    const read = async (id: number): Promise<boolean> => {
      try {
        const payload = await api<Payload>(
          `/nodes/${id}/metrics?hours=${WINDOW_HOURS}&points=60&series=ping`,
        )
        seen.set(id, { q: parsePing(payload), at: Date.now() })
        return true
      } catch {
        // A node that cannot be probed right now keeps whatever it read last
        // cycle; only when that ages out does the row disappear.
        return false
      }
    }

    const load = async () => {
      if (running) return
      running = true
      try {
        const failed: number[] = []
        for (let i = 0; i < ids.length; i += CHUNK) {
          const batch = ids.slice(i, i + CHUNK)
          const good = await Promise.all(batch.map(read))
          if (!alive) return
          good.forEach((ok, j) => {
            if (!ok) failed.push(batch[j])
          })
          // Published per chunk rather than once at the end: the rows fill in
          // over a second or two instead of the whole fleet appearing at once
          // after the slowest node answers.
          publish()
        }
        if (failed.length > 0) {
          setTimeout(() => {
            void Promise.all(failed.map(read)).then(() => publish())
          }, RETRY_MS)
        }
      } finally {
        running = false
      }
    }

    void load()
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
   * window while it is switched on is one request round-trip -- and the map is
   * refreshed every minute, so a reading cannot freeze there.
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
