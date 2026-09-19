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

/** Who is looking at the panel, as `/me` reports it. */
export type Me = { authed: boolean; github: boolean; site_name: string; public_page: boolean }

/**
 * Whether a response from `/me` is one we actually understand.
 *
 * `api<T>` is a type parameter and nothing more: it promises this shape at
 * compile time and checks nothing when the response arrives. That mattered
 * because the one decision hanging off this call is a redirect -- an unreadable
 * `public_page` reads as `false`, and `false` means "send them to /admin/". So
 * a hub one version behind, or a proxy's error page that happened to parse as
 * JSON, would have thrown every visitor to a public probe page into the admin
 * login. A response is now only acted on if it can be read.
 */
export function isMe(v: unknown): v is Me {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return typeof o.public_page === "boolean" || typeof o.authed === "boolean"
}

/**
 * Whatever went wrong, in one short sentence a visitor can read.
 *
 * `e.message` was being printed straight onto the page in four places, and
 * `e.message` is whatever the other end sent: a Go stack line, a proxy's HTML,
 * "unexpected end of JSON input". A panel that explains itself in someone
 * else's error text is not explaining itself. Only the status is trusted --
 * anything unrecognised is a network problem, because that is what it usually
 * is, and none of these leak anything worth hiding either way.
 */
export function friendly(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) return "登录状态已失效"
    if (e.status === 404) return "接口不存在"
    if (e.status >= 500) return "服务暂时不可用"
    return "请求失败"
  }
  if (e instanceof Error && e.name === "TypeError") return "网络错误"
  return "网络错误"
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  })
  if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText)
  return res.status === 204 ? (undefined as T) : res.json()
}

/**
 * The previous list, when nothing in it moved.
 *
 * The whole point of `safeNodes` handing back identical objects is that the
 * consumers downstream -- the sort, the country set, the filter, and every
 * memoised card -- can skip their work on a tick where nothing changed, which
 * on a quiet fleet is most of them. Returning a new array of the same elements
 * would defeat that at the last step.
 */
export function sameList(prev: Node[] | null, next: Node[]): Node[] {
  if (!prev) return next
  if (prev.length !== next.length) return next
  return prev.every((n, i) => n === next[i]) ? prev : next
}

/**
 * How long to wait before reconnecting, doubling from a second to half a minute.
 *
 * Capped: 2 ** 20 milliseconds is a fortnight, and a hub that goes down for
 * five minutes would otherwise be retried next by a tab nobody has looked at
 * since.
 */
export function backoffMs(attempts: number): number {
  return Math.min(30_000, 1000 * 2 ** attempts)
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

/**
 * Whether two payloads say the same thing about a node.
 *
 * Every push parses a fresh JSON tree, so `metrics` is always a new object even
 * when not one number moved. Comparing field by field rather than by reference
 * is what lets the previous `Node` be handed back untouched.
 */
function sameMetrics(a: Metrics | null, b: Metrics | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  for (const key of NUMERIC_FIELDS) if (a[key] !== b[key]) return false
  const la = a.load
  const lb = b.load
  if (la === lb) return true
  if (!la || !lb) return false
  return la[0] === lb[0] && la[1] === lb[1] && la[2] === lb[2]
}

function sameNode(a: Node, b: Node): boolean {
  if (a === b) return true
  // The union, because an authenticated payload carries keys a public one does
  // not: comparing only one side would miss a field that appeared.
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === "metrics" || key === "metrics_invalid") continue
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false
  }
  return a.metrics_invalid === b.metrics_invalid && sameMetrics(a.metrics ?? null, b.metrics ?? null)
}

/**
 * Cleans a payload, reusing last tick's objects wherever nothing changed.
 *
 * Minting a fresh `Node` for every host on every push meant the sort, the
 * country set and the filtered list all recomputed twice a second, and no card
 * could be memoised -- the identity of every node changed whether or not a
 * number did. `previous` is the caller's map from the last pass; a node whose
 * values are identical comes back as the same object.
 */
/**
 * The string fields are read with string methods (`toLowerCase`, `trim`,
 * `localeCompare`) and `price` with `toFixed`, and a single field of the wrong
 * primitive from the hub would throw inside render -- where there is no error
 * boundary, that is a white panel, not one broken card.
 */
const text = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""))
const money = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0

export function safeNodes(nodes: Node[], previous?: Map<number, Node>): Node[] {
  return nodes.map((node) => {
    const { metrics, invalid } = safeMetrics(node.metrics)
    const next: Node = {
      ...node,
      name: text(node.name),
      country: text(node.country),
      os: text(node.os),
      kernel: text(node.kernel),
      arch: text(node.arch),
      virt: text(node.virt),
      cpu_name: text(node.cpu_name),
      price: money(node.price),
      /*
       * The text fields this page prints without escaping or defaulting.
       *
       * Eight were being cleaned and the rest were being rendered as whatever
       * arrived: `CYCLES[node.billing_cycle]` indexed a lookup with `undefined`
       * and printed an empty renewal period, and `money(price, currency)` put
       * `undefined` where the symbol should be -- both on a card that is
       * otherwise intact, which is the confusing kind of broken.
       */
      currency: text(node.currency),
      billing_cycle: text(node.billing_cycle),
      remark: text(node.remark),
      hostname: text(node.hostname),
      ip: text(node.ip),
      ipv4: text(node.ipv4),
      ipv6: text(node.ipv6),
      metrics: invalid ? null : metrics,
    }
    if (invalid) next.metrics_invalid = true
    else delete next.metrics_invalid
    const before = previous?.get(node.id)
    return before && sameNode(before, next) ? before : next
  })
}

export type LinkMode = "connecting" | "live" | "polling"
export type LinkState = { mode: LinkMode; updatedAt: number }

/** Three pushes at a 2 s cadence: past this the socket is presumed half-open. */
const WATCHDOG_MS = 6000
const POLL_MS = 5000
/** A poll that has not answered in this long has failed, whatever it says. */
const POLL_TIMEOUT_MS = 10_000

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

    let seen = new Map<number, Node>()
    let inflight = false

    const receive = (list: Node[], mode: LinkMode) => {
      // A poll that raced the unmount: React 19 ignores the setState, but the
      // `seen` map would still be swapped for data nobody will ever show.
      if (disposed) return
      const safe = safeNodes(list, seen)
      seen = new Map(safe.map((n) => [n.id, n]))
      updatedAt = Date.now()
      // Handing back the previous array when every element is the same object
      // lets the sort, the country set and the filter skip their work on a tick
      // where nothing moved -- which, on a quiet fleet, is most of them.
      setNodes((prev) => sameList(prev, safe))
      setError(null)
      setClosed(false)
      setLink({ mode, updatedAt })
    }

    const fetchOnce = () => {
      // One poll at a time. The interval, the visibility handler and the initial
      // read can all land inside one slow round-trip; without this the replies
      // raced, and the older one could overwrite the newer.
      if (inflight) return
      inflight = true
      // Unbounded fetches were the other half of that race: a poll on a stalled
      // link could outlive the next one, or several of them. Aborting also
      // surfaces the stall as an error instead of leaving `inflight` pinned
      // until the page reloads.
      const ctrl = new AbortController()
      const bail = setTimeout(() => ctrl.abort(), POLL_TIMEOUT_MS)
      api<{ nodes: Node[] }>("/nodes", { signal: ctrl.signal })
        .then((d) => receive(d.nodes, "polling"))
        .catch((e: Error) => {
          if (e.name === "AbortError") setError("轮询超时")
          else setError(friendly(e))
          if (e instanceof ApiError && e.status === 401) {
            setClosed(true)
            /*
             * And stop asking. A closed session left its poll running, so the
             * panel went on requesting a list it had just been refused, every
             * five seconds, for as long as the tab was open -- re-failing
             * instead of saying once that the session had ended.
             */
            if (poll) {
              clearInterval(poll)
              poll = null
            }
          }
        })
        .finally(() => {
          inflight = false
          clearTimeout(bail)
        })
    }

    void fetchOnce()

    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`

    const connect = () => {
      if (disposed) return
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch {
        // The constructor can throw where the protocol is blocked; that is the
        // same "socket is not coming back" verdict as onclose, so it backs off
        // the same way rather than hammering once every POLL_MS.
        poll ??= setInterval(fetchOnce, POLL_MS)
        if (retry) clearTimeout(retry)
        retry = setTimeout(connect, backoffMs(attempts++))
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
        retry = setTimeout(connect, backoffMs(attempts))
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
