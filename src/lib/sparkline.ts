import { useEffect, useMemo, useState } from "react"

import { api, type Node } from "@/lib/api"
import { chunk } from "@/lib/quality"

type Payload = { metrics: { cpu: unknown }[] }

const CHUNK = 6
const REFRESH_MS = 60_000
const WINDOW_HOURS = 1

/** The latest ~60 CPU readings per node, as a flat list. Empty for a node that
 *  has not been reached yet or whose fetch failed. */
export function useCpuSparkline(enabled: boolean, nodes: Node[] | null): Map<number, number[]> {
  const key = nodes?.map((n) => n.id).join(",") ?? ""
  const ids = useMemo(() => (key ? key.split(",").map(Number) : []), [key])
  const active = enabled && ids.length > 0

  const [data, setData] = useState<Map<number, number[]>>(new Map())

  useEffect(() => {
    if (!active) return

    let alive = true

    const read = async (id: number) => {
      try {
        const p = await api<Payload>(
          `/nodes/${id}/metrics?hours=${WINDOW_HOURS}&points=60&series=metrics`,
        )
        const vs = (p.metrics ?? [])
          .filter((m): m is { cpu: number } => typeof m.cpu === "number" && Number.isFinite(m.cpu))
          .map((m) => m.cpu)
        return [id, vs] as const
      } catch {
        return null
      }
    }

    const load = async () => {
      const next = new Map<number, number[]>()
      for (const batch of chunk(ids, CHUNK)) {
        const results = await Promise.all(batch.map(read))
        for (const r of results) if (r) next.set(r[0], r[1])
        if (!alive) return
        setData(new Map(next))
      }
    }

    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [active, ids])

  return active ? data : new Map()
}