import { useEffect, useState } from "react"

/**
 * Live metrics for one node.
 *
 * Every field is nullable on purpose. The hub only sends what the agent
 * reported, and an agent missing a field is ordinary rather than exceptional --
 * OpenVZ containers have no swap, some kernels report no `procs`. A single
 * absent field used to discard the whole object and blank the entire card, so
 * the two are separated: a field that cannot be read is `null` and renders as
 * "—", while `metrics` going null means there was nothing readable at all.
 */
export type Metrics = {
  uptime: number | null
  cpu: number | null
  load: [number, number, number] | null
  mem_total: number | null
  mem_used: number | null
  swap_total: number | null
  swap_used: number | null
  disk_total: number | null
  disk_used: number | null
  net_rx: number | null
  net_tx: number | null
  total_rx: number | null
  total_tx: number | null
  month_rx: number | null
  month_tx: number | null
  tcp: number | null
  udp: number | null
  procs: number | null
}

/**
 * A node as the public API returns it.
 *
 * `hostname`, `ip`, `ipv4`, `ipv6` and `remark` are appended only for an
 * authenticated caller: to a visitor those keys do not exist at all, rather than
 * arriving empty. `metrics_invalid` is added locally by `safeNodes`.
 */
export type Node = {
  id: number
  name: string
  sort: number
  public: boolean
  online: boolean
  country: string
  last_seen: number
  metrics: Metrics | null
  /** The hub sent metrics, but none of the core fields could be read. */
  metrics_invalid?: boolean
  os: string
  kernel: string
  arch: string
  virt: string
  cpu_name: string
  cpu_cores: number
  mem_total: number
  swap_total: number
  disk_total: number
  agent_version: string
  price: number
  currency: string
  billing_cycle: string
  expires_at: string | null
  traffic_limit: number
  traffic_mode: string
  traffic_reset_day: number
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  month_start: string
  day_rx: number
  day_tx: number
  hostname?: string
  ip?: string
  ipv4?: string
  ipv6?: string
  remark?: string
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  })
  if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText)
  return res.status === 204 ? (undefined as T) : res.json()
}

const KEEP = 60
export const speedHistory: { rx: number; tx: number }[] = []

function sample(nodes: Node[]) {
  const live = nodes.filter((n) => n.online && n.metrics)
  speedHistory.push({
    rx: live.reduce((s, n) => s + (n.metrics?.net_rx ?? 0), 0),
    tx: live.reduce((s, n) => s + (n.metrics?.net_tx ?? 0), 0),
  })
  if (speedHistory.length > KEEP) speedHistory.shift()
}

type NumericKey = Exclude<keyof Metrics, "load">

/** Exactly the hub's anonymous metrics allowlist. */
const NUMERIC_FIELDS = [
  "uptime", "cpu", "mem_total", "mem_used", "swap_total", "swap_used",
  "disk_total", "disk_used", "net_rx", "net_tx", "total_rx", "total_tx",
  "month_rx", "month_tx", "tcp", "udp", "procs",
] as const satisfies readonly NumericKey[]

/**
 * Read none of these and the payload is not a set of metrics at all -- a
 * truncated response, or a shape this theme does not know. Only then is the
 * whole object thrown away and the node marked unavailable, which the UI shows
 * differently from the ordinary "connected, has not reported yet".
 */
const CORE_FIELDS = ["cpu", "mem_total", "mem_used", "disk_total", "disk_used"] as const satisfies readonly NumericKey[]

const usable = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0

/**
 * Cleans one payload, field by field. Malformed numbers become null and are
 * rendered as "—"; the rest of the card keeps working.
 */
export function safeMetrics(raw: unknown): { metrics: Metrics | null; invalid: boolean } {
  if (raw === null || raw === undefined) return { metrics: null, invalid: false }
  if (typeof raw !== "object") return { metrics: null, invalid: true }

  const source = raw as Record<string, unknown>
  const clean = Object.fromEntries(
    NUMERIC_FIELDS.map((key) => [key, usable(source[key]) ? source[key] : null]),
  ) as unknown as Metrics

  const load = source.load
  clean.load = Array.isArray(load) && load.length === 3 && load.every(usable)
    ? (load as [number, number, number])
    : null

  return CORE_FIELDS.some((key) => clean[key] !== null)
    ? { metrics: clean, invalid: false }
    : { metrics: null, invalid: true }
}

export function safeNodes(nodes: Node[]): Node[] {
  return nodes.map((node) => {
    const { metrics, invalid } = safeMetrics(node.metrics)
    const next: Node = { ...node, metrics: invalid ? null : metrics }
    if (invalid) next.metrics_invalid = true
    else delete next.metrics_invalid
    return next
  })
}

export type LinkMode = "connecting" | "live" | "polling"
export type LinkState = { mode: LinkMode; updatedAt: number }

/** Three pushes at a 2 s cadence: past this the socket is presumed half-open. */
const WATCHDOG_MS = 6000
const POLL_MS = 5000

export function useNodes() {
  const [nodes, setNodes] = useState<Node[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)
  const [link, setLink] = useState<LinkState>({ mode: "connecting", updatedAt: 0 })

  useEffect(() => {
    let socket: WebSocket | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let watchdog: ReturnType<typeof setInterval> | null = null
    let disposed = false
    let attempts = 0
    let updatedAt = 0

    const receive = (list: Node[], mode: LinkMode) => {
      const safe = safeNodes(list)
      sample(safe)
      updatedAt = Date.now()
      setNodes(safe)
      setError(null)
      setClosed(false)
      setLink({ mode, updatedAt })
    }

    const fetchOnce = () =>
      api<{ nodes: Node[] }>("/nodes")
        .then((d) => receive(d.nodes, "polling"))
        .catch((e: Error) => {
          setError(e.message)
          if (e instanceof ApiError && e.status === 401) setClosed(true)
        })

    void fetchOnce()

    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`

    const connect = () => {
      if (disposed) return
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch {
        poll ??= setInterval(fetchOnce, POLL_MS)
        retry = setTimeout(connect, POLL_MS)
        return
      }
      socket = ws

      // A half-open connection is the failure that matters here: `onmessage`
      // stops firing and `onclose` never fires either, so the page keeps showing
      // one frozen set of numbers as though it were live. Closing forces the
      // normal reconnect path. Skipped while hidden, where the browser throttles
      // timers and an idle socket looks indistinguishable from a dead one.
      if (watchdog) clearInterval(watchdog)
      watchdog = setInterval(() => {
        if (document.visibilityState !== "visible") return
        if (Date.now() - updatedAt > WATCHDOG_MS) ws.close()
      }, 1000)

      ws.onmessage = (event) => {
        let payload: { nodes?: Node[] }
        try {
          payload = JSON.parse(String(event.data))
        } catch {
          return
        }
        if (!Array.isArray(payload.nodes)) return
        attempts = 0
        receive(payload.nodes, "live")
        if (poll) {
          clearInterval(poll)
          poll = null
        }
      }
      // An error raised by a socket that has already been superseded must close
      // its own socket, not whichever one the outer variable now points at.
      ws.onerror = () => ws.close()
      ws.onclose = () => {
        if (watchdog) {
          clearInterval(watchdog)
          watchdog = null
        }
        if (socket === ws) socket = null
        if (disposed) return
        poll ??= setInterval(fetchOnce, POLL_MS)
        setLink({ mode: "polling", updatedAt })
        if (retry) clearTimeout(retry)
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts))
        attempts++
      }
    }
    connect()

    // A tab left in the background overnight comes back to a socket that is
    // usually dead and a view that does not know it. Read once immediately, and
    // when what is on screen is stale, drop the socket so it reconnects.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return
      const stale = Date.now() - updatedAt > WATCHDOG_MS
      void fetchOnce()
      if (stale) socket?.close()
    }
    addEventListener("visibilitychange", onVisible)

    return () => {
      disposed = true
      removeEventListener("visibilitychange", onVisible)
      socket?.close()
      if (poll) clearInterval(poll)
      if (retry) clearTimeout(retry)
      if (watchdog) clearInterval(watchdog)
    }
  }, [])

  return { nodes, error, closed, link }
}
