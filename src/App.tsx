import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, LayoutGrid, List, Moon, Search, Sun, Wrench, X } from "lucide-react"

import { ErrorBoundary } from "@/components/ErrorBoundary"
import { FlagSprite } from "@/components/Flag"
import { NodeCard } from "@/components/NodeCard"
import { Summary } from "@/components/Summary"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api, useNodes, type LinkState, type Node } from "@/lib/api"
import { daysUntil, percent, SOON_DAYS } from "@/lib/format"
import { alertLevel, health, loadPercent, monthUsage, stale, worstSeverity } from "@/lib/node"
import { useNetworkQuality } from "@/lib/quality"
import { CHUNK_RELOAD_KEY } from "@/lib/reload"
import { cn } from "@/lib/utils"

type Me = { authed: boolean; github: boolean; site_name: string; public_page: boolean }

/** What the header shows while /me is unreachable. See the render below. */
const FALLBACK_ME: Me = { authed: false, github: false, site_name: "", public_page: true }

const THEME_KEY = "monitor-simple:theme"
const ALL = "全部节点"

/** One shape for every toolbar control, so the row reads as a single line. */
const CONTROL =
  "h-8 rounded-lg border bg-card px-2 text-xs text-muted-foreground outline-none focus:border-ring"

const VIEWS = ["grid", "list"] as const
type View = (typeof VIEWS)[number]

const SORTS = [
  { key: "default", label: "问题优先" },
  { key: "cpu", label: "CPU 占用" },
  { key: "mem", label: "内存占用" },
  { key: "traffic", label: "本月流量" },
  { key: "expiry", label: "到期时间" },
] as const
type SortKey = (typeof SORTS)[number]["key"]

const memoryUse = (n: Node) => percent(n.metrics?.mem_used ?? null, n.metrics?.mem_total ?? null) ?? -1

/**
 * Where a node belongs in the list, lowest first.
 *
 * The panel exists to answer "which one is wrong", and the default order was the
 * hub's own `sort` field: an offline host could sit in the middle of the third
 * row while the visitor read the grid from the top. Everything asking to be
 * looked at now comes first, in the order it wants attention.
 */
function rank(n: Node): number {
  const state = health(n)
  if (state === "offline") return 0
  if (state === "invalid") return 1
  if (state !== "ok") return state === "pending" ? 4 : 6
  const readings = worstSeverity(n)
  if (readings === "danger") return 2
  if (readings === "warn") return 3
  return stale(n) !== null ? 4 : 5
}

/** The heaviest reading on a node, to order within a rank. */
function pressure(n: Node): number {
  const m = n.metrics
  if (!m) return -1
  return Math.max(
    m.cpu ?? -1,
    percent(m.mem_used, m.mem_total) ?? -1,
    percent(m.disk_used, m.disk_total) ?? -1,
    loadPercent(n) ?? -1,
  )
}

const COMPARATORS: Record<SortKey, (a: Node, b: Node) => number> = {
  default: (a, b) => rank(a) - rank(b) || pressure(b) - pressure(a) || a.sort - b.sort || a.id - b.id,
  cpu: (a, b) => (b.metrics?.cpu ?? -1) - (a.metrics?.cpu ?? -1),
  mem: (a, b) => memoryUse(b) - memoryUse(a),
  traffic: (a, b) => monthUsage(b) - monthUsage(a),
  expiry: (a, b) =>
    (daysUntil(a.expires_at) ?? Number.POSITIVE_INFINITY) -
    (daysUntil(b.expires_at) ?? Number.POSITIVE_INFINITY),
}

const importDetail = () => import("@/components/NodeDetail").then((m) => ({ default: m.NodeDetail }))

/**
 * Warm the detail chunk, once the page has nothing better to do.
 *
 * This ran on mount, so every visitor parsed the charting library -- around
 * 100 KB gzipped -- before the list was interactive, including the ones who
 * never open a node. A failure is left alone: reloading the page to rescue a
 * prefetch would be the tail wagging the dog.
 */
const preloadDetail = () => {
  const run = () => void importDetail().catch(() => {})
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 3000 })
  else setTimeout(run, 1500)
}

/**
 * The load path that actually renders.
 *
 * A theme is replaced in place while its chunk filenames carry a content hash,
 * so a visitor still holding the previous `index.html` asks for files that no
 * longer exist. The lazy rejection had nothing above it to land on: the whole
 * page went blank, and reloading by hand did not help because the browser served
 * the same stale HTML. One reload gets fresh HTML; the session key stops it from
 * looping if that does not fix it either.
 */
const loadDetail = () =>
  importDetail().catch((cause: unknown) => {
    if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, "1")
      location.reload()
      // Stay pending until the reload lands, so the skeleton remains in place
      // rather than an error panel flashing up on the way out.
      return new Promise<never>(() => {})
    }
    throw cause
  })

const NodeDetail = lazy(loadDetail)

function useNodeRoute() {
  const read = () => {
    const match = location.pathname.match(/^\/node\/(\d+)/)
    return match ? Number(match[1]) : null
  }
  const [id, setId] = useState(read)
  useEffect(() => {
    const sync = () => setId(read())
    addEventListener("popstate", sync)
    return () => removeEventListener("popstate", sync)
  }, [])
  /**
   * Opening pushes a route; closing goes back through it.
   *
   * Closing by pushing "/" left the detail view sitting in the session history,
   * so the browser's own back button -- the first thing anyone presses -- walked
   * from the list straight back into the node that had just been dismissed, and
   * the forward button then offered to close it again. Popping the entry makes
   * the browser's chrome agree with the button in the header.
   *
   * A detail view opened from a pasted link has no entry to pop, and going back
   * there would leave the panel for whatever site came before it. `history.state`
   * records which of the two this is.
   */
  const go = useCallback((next: number | null) => {
    const url = `${next === null ? "/" : `/node/${next}`}${location.search}`
    if (next === null) {
      if ((history.state as { node?: number } | null)?.node) {
        history.back()
        setId(null)
        return
      }
      history.replaceState({}, "", url)
    } else {
      history.pushState({ node: next }, "", url)
      scrollTo(0, 0)
    }
    setId(next)
  }, [])
  return [id, go] as const
}

function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY)
    return saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches
  })
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light")
  }, [dark])
  return [dark, () => setDark((d) => !d)] as const
}

type Filters = { country: string; status: string; query: string; sort: SortKey; view: View }

/** Filters live in the URL so "send me the offline ones" is a link, not a chore. */
function readFilters(): Filters {
  const p = new URLSearchParams(location.search)
  const view = p.get("view")
  const sort = p.get("sort")
  return {
    country: p.get("country") ?? ALL,
    status: p.get("status") ?? "全部",
    query: p.get("q") ?? "",
    sort: SORTS.some((s) => s.key === sort) ? (sort as SortKey) : "default",
    view: VIEWS.includes(view as View) ? (view as View) : "grid",
  }
}

/**
 * Freshness. A panel that pushes every two seconds fails worst when it fails
 * quietly: a half-open socket leaves one frozen set of numbers on screen and no
 * indication that they stopped moving. `role="status"` announces each change,
 * and only changes on the transition -- the age is in the tooltip, where it
 * updates without being read out every second.
 */
function LinkStatus({ link }: { link: LinkState }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const age = link.updatedAt ? Math.round((now - link.updatedAt) / 1000) : 0
  const [dot, label, title] =
    age > 10
      ? ["bg-destructive", "已断开", `最后更新在 ${age} 秒前`]
      : link.mode === "live"
        ? ["bg-ok", "实时", "WebSocket 推送，每 2 秒一次"]
        : link.mode === "polling"
          ? ["bg-warn", "轮询中", "WebSocket 未连上，已回落到每 5 秒轮询"]
          : ["bg-warn", "连接中", "正在连接实时推送"]

  return (
    <span role="status" title={title} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", dot)} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  )
}

export default function App() {
  const [dark, toggleTheme] = useTheme()
  const [me, setMe] = useState<Me | null>(null)
  const [meError, setMeError] = useState("")
  const { nodes, error, closed, link } = useNodes()
  const [open, go] = useNodeRoute()
  const [filters, setFilters] = useState(readFilters)
  const { country, status, query, sort, view } = filters
  const [qualityOn, setQualityOn] = useState(false)
  const quality = useNetworkQuality(qualityOn, nodes)

  const loadMe = useCallback(() => {
    return api<Me>("/me")
      .then((next) => { setMe(next); setMeError("") })
      .catch((e: Error) => setMeError(e.message || "网络错误"))
  }, [])

  useEffect(() => {
    void loadMe()
    preloadDetail()
  }, [loadMe])

  useEffect(() => {
    if (closed) void loadMe()
  }, [closed, loadMe])

  useEffect(() => {
    if (me && !me.public_page && !me.authed) location.href = "/admin/"
  }, [me])

  const sorted = useMemo(() => [...(nodes ?? [])].sort(COMPARATORS[sort]), [nodes, sort])
  const selected = sorted.find((n) => n.id === open)

  /**
   * Which card to hand focus back to.
   *
   * Opening a node pushes a client-side route: the card that was clicked is
   * unmounted, so the focused element disappears and the keyboard position is
   * lost with it -- a screen reader gets no announcement that anything changed.
   *
   * Remembered as an href, not as the element. Holding the DOM node itself was
   * the obvious version and it did nothing at all: the list is unmounted while
   * the detail view is on screen, so by the time focus would be restored the
   * element it points at is detached from the document and `.focus()` on it
   * leaves the page on `<body>`. Looking the card up again after the list has
   * been re-rendered is what makes the round trip land. Verified by pressing
   * Escape and reading `document.activeElement`.
   */
  const opener = useRef<string | null>(null)

  const openNode = useCallback((id: number) => {
    opener.current = `/node/${id}`
    go(id)
  }, [go])

  const closeNode = useCallback(() => go(null), [go])

  useEffect(() => {
    if (open !== null || opener.current === null) return
    const href = opener.current
    opener.current = null
    document.querySelector<HTMLElement>(`a[href="${href}"]`)?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    const title = [selected?.name, me?.site_name || "Monitor"].filter(Boolean).join(" · ")
    document.title = open !== null && !selected ? `节点不存在 · ${me?.site_name || "Monitor"}` : title
  }, [selected, open, me?.site_name])

  /**
   * Countries come straight from the API field the badges already use. The
   * previous version guessed one out of the node name through a 25-entry alias
   * table, which meant a badge and its filter could disagree -- and a name
   * prefix the table did not know dropped the node out of every category.
   * `country` is readable anonymously, so there was never a reason to guess.
   */
  const countries = useMemo(() => {
    const set = new Set<string>()
    for (const n of sorted) if (n.country) set.add(n.country)
    return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"))
  }, [sorted])

  // Once the last node of a country goes away the filter would select nothing,
  // with no chip left to explain why. Derived during render rather than
  // corrected in an effect: no second pass, and the URL never carries a value
  // that is not on screen.
  const activeCountry = country === ALL || countries.includes(country) ? country : ALL

  // Filters live in the URL, so "send me the offline ones" is a link to hand
  // over rather than a list of instructions, and a reload keeps them.
  useEffect(() => {
    const p = new URLSearchParams()
    if (activeCountry !== ALL) p.set("country", activeCountry)
    if (status !== "全部") p.set("status", status)
    if (query) p.set("q", query)
    if (sort !== "default") p.set("sort", sort)
    if (view !== "grid") p.set("view", view)
    const search = p.toString()
    history.replaceState(history.state, "", `${location.pathname}${search ? `?${search}` : ""}`)
  }, [activeCountry, status, query, sort, view])

  // The count on a chip has to match what clicking it shows. Counting over the
  // whole fleet while the cards honour the country and search filters was how
  // a chip promised two offline nodes and the list delivered none. The scope
  // (everything but the status) is computed once and the counts ride on it.
  const scoped = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return sorted.filter((n) => {
      if (activeCountry !== ALL && n.country !== activeCountry) return false
      // ip, ipv4, ipv6 and remark do not exist for a visitor, so searching them
      // only ever produced "nothing matched".
      if (needle && ![n.name, n.country].some((v) => v?.toLowerCase().includes(needle))) return false
      return true
    })
  }, [sorted, activeCountry, query])

  // One pass over the scoped list instead of four: every chip count comes from
  // the same walk, and the push cadence stops paying for the reads.
  const counts = useMemo(() => {
    let offline = 0
    let unconnected = 0
    let alerting = 0
    let expiring = 0
    for (const n of scoped) {
      const state = health(n)
      if (state === "offline") offline++
      else if (state === "unconnected") unconnected++
      if (alertLevel(n) !== "normal") alerting++
      const d = daysUntil(n.expires_at)
      if (d !== null && d >= 0 && d <= SOON_DAYS) expiring++
    }
    return { offline, unconnected, alerting, expiring }
  }, [scoped])

  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (open === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeNode()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [open, closeNode])

  const statusTabs = [
    // "全部" carries the count too. It was the only chip without one, which
    // made five controls of four different widths and left the one people
    // click most looking like a label rather than a filter.
    { key: "全部", label: `全部 ${scoped.length}` },
    { key: "告警", label: `告警 ${counts.alerting}` },
    { key: "离线", label: `离线 ${counts.offline}` },
    { key: "即将到期", label: `即将到期 ${counts.expiring}` },
    { key: "未接入", label: `未接入 ${counts.unconnected}` },
  ]

  const filtered = useMemo(() => {
    return scoped.filter((n) => {
      if (status === "告警" && alertLevel(n) === "normal") return false
      if (status === "离线" && health(n) !== "offline") return false
      if (status === "即将到期") {
        const d = daysUntil(n.expires_at)
        if (d === null || d < 0 || d > SOON_DAYS) return false
      }
      if (status === "未接入" && health(n) !== "unconnected") return false
      return true
    })
  }, [scoped, status])

  const resetFilters = () => setFilters({ country: ALL, status: "全部", query: "", sort, view })

  // Stable identities, so the memoised Summary skips its five reduce/filter
  // walks on every push where the fleet did not move.
  const onExpiring = useCallback(() => setFilters((f) => ({ ...f, status: "即将到期" })), [])
  const onAlerting = useCallback(() => setFilters((f) => ({ ...f, status: "告警" })), [])

  if (!me && !meError) return (
    <div className="grid min-h-svh place-items-center p-6 text-sm text-muted-foreground">
      加载中…
    </div>
  )

  // /me failed once: degrade rather than block. What the page loses is a site
  // name and an admin link (FALLBACK_ME supplies both as absence); the fleet
  // underneath is protected by the node API itself, which answers 401 to a
  // visitor on a private hub and shows that error where the list would be. A
  // one-shot endpoint failing was never a good reason to make the whole page
  // read "重试".
  const meta = me ?? FALLBACK_ME

  if (me && !me.public_page && !me.authed) return null

  return (
    <div className="min-h-svh">
      <FlagSprite />
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
          {/*
           * The detail page is a client-side route: pushing it leaves no browser
           * chrome to go back with, and the site name is not an obvious exit.
           * The button lives in the sticky header rather than next to the node
           * name so it stays reachable after scrolling a long chart page.
           */}
          {open !== null && (
            <Button variant="ghost" size="sm" className="-ml-2 shrink-0" onClick={closeNode}>
              <ArrowLeft /> 返回列表
            </Button>
          )}
          <button className="min-w-0 truncate font-semibold transition-opacity hover:opacity-70" onClick={closeNode}>
            {meta.site_name || "Monitor"}
          </button>
          <div className="flex-1" />
          <LinkStatus link={link} />
          <Button variant="ghost" size="sm" asChild>
            <a href="/admin/">
              <Wrench /> {meta.authed ? "进入后台" : "登录"}
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            title="切换主题"
            aria-label={dark ? "切换到浅色主题" : "切换到深色主题"}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-4 sm:px-6">
        {!me && meError && (
          <p
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground"
          >
            <span>站点信息读取失败：{meError}。以下内容按只读模式显示。</span>
            <button className="underline" onClick={() => void loadMe()}>重试</button>
          </p>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

        {open !== null ? (
          !nodes ? (
            <Skeleton className="h-96" />
          ) : selected ? (
            <ErrorBoundary onReset={closeNode}>
              <Suspense fallback={<Skeleton className="h-96" />}>
                <NodeDetail node={selected} />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              节点不存在或未公开。<button className="underline" onClick={closeNode}>返回列表</button>
            </p>
          )
        ) : !nodes ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-72" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          /*
           * An empty fleet gets one sentence and nothing else.
           *
           * Five cells of zeroes above a toolbar whose only option is "全部地区"
           * is noise arranged around a message, and on a hub with no nodes the
           * message is the whole page.
           */
          <p className="py-16 text-center text-sm text-muted-foreground">
            还没有节点。在 hub 后台添加第一台。
          </p>
        ) : (
          <>
            <Summary
              nodes={sorted}
              onExpiring={onExpiring}
              onAlerting={onAlerting}
            />

            {/*
              工具栏：状态筛选在上，地区/排序/搜索/视图在下。

              A two-column grid below sm. As a wrapping flex row this stacked
              into five or six lines at 375px and ate the whole first screen,
              with the flex-1 spacer contributing a line of its own; the status
              chips now scroll sideways rather than wrapping onto three rows.

              Every control is 44px tall on a phone and 32px from sm up. The
              panel is used on a phone quite a lot and a 30px chip beside a
              30px select is a row of near-misses for a thumb.
            */}
            <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
              <div className="col-span-2 -mx-1 flex gap-1 overflow-x-auto px-1 sm:col-span-1 sm:mx-0 sm:px-0">
                {statusTabs.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setFilters((f) => ({ ...f, status: s.key }))}
                    aria-pressed={status === s.key}
                    className={cn(
                      "shrink-0 rounded-lg px-3 py-3 text-[13px] transition-colors sm:py-1.5",
                      status === s.key
                        ? /*
                            * Selected carries a ring, not just a fill. The two
                            * states were the same accent at 100% and 60%, which
                            * is a difference visible only to someone who has
                            * already hovered both.
                            */
                          "bg-foreground/10 font-medium text-foreground ring-1 ring-foreground/20"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
                {/*
                  * 网络质量 rides the scrolling chip row instead of taking a
                  * line of its own. At 375px the toolbar was five rows -- chips,
                  * selects, search, this, view switch -- and 254px of it, which
                  * is most of the first screen on a phone. It is a preference
                  * rather than a filter, so it keeps a border the chips do not
                  * have; that outline is the only thing separating it from the
                  * four status filters it now sits beside.
                  */}
                <label
                  title={`每分钟为 ${sorted.length} 台各请求一次延迟数据`}
                  className="ml-1 flex h-11 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs text-muted-foreground sm:ml-0 sm:h-8 sm:px-2"
                >
                  <input
                    type="checkbox"
                    checked={qualityOn}
                    onChange={(e) => setQualityOn(e.target.checked)}
                    className="size-4 accent-foreground sm:size-3"
                  />
                  网络质量
                </label>
              </div>
              <div className="relative col-span-2 sm:col-span-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                  onKeyDown={(e) => {
                    // Escape empties the box before it closes anything: the
                    // global handler only knows about the open detail view, so
                    // clearing a search with the key everyone reaches for used
                    // to do nothing at all.
                    if (e.key === "Escape" && query) {
                      e.stopPropagation()
                      setFilters((f) => ({ ...f, query: "" }))
                    }
                  }}
                  aria-label="搜索节点"
                  placeholder="搜索名称或地区（/）"
                  /*
                   * 16px below sm. Safari zooms the page in on focus for any
                   * input smaller than that, which on this toolbar means the
                   * whole layout lurches sideways the moment it is touched.
                   */
                  className="h-11 w-full rounded-lg border bg-card pl-8 pr-9 text-base outline-none placeholder:text-muted-foreground focus:border-ring sm:h-8 sm:w-48 sm:text-xs"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="清除搜索"
                    onClick={() => {
                      setFilters((f) => ({ ...f, query: "" }))
                      searchRef.current?.focus()
                    }}
                    className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:size-6"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              {/*
                * Off by default, and the only control here that costs the hub
                * anything: switching it on asks each node's history endpoint
                * once a minute. The cost is in the tooltip rather than only in a
                * comment -- on a fifty-node fleet it is fifty requests a minute
                * the panel does not otherwise make, and the person switching it
                * on is the only one who can decide whether that is worth it.
                */}
              {/*
                * 地区、排序和视图切换 share one line. They are the three
                * narrowest controls and the three least likely to be wanted at
                * the same moment, so 375px hands each select about 120px and
                * the view switch the 88px two icons need -- one row here
                * instead of the three they used to cost.
                */}
              <div className="col-span-2 flex gap-2 sm:col-span-1 sm:gap-1.5">
                <select
                  value={activeCountry}
                  onChange={(e) => setFilters((f) => ({ ...f, country: e.target.value }))}
                  aria-label="地区筛选"
                  className={cn(CONTROL, "h-11 min-w-0 flex-1 sm:h-8 sm:w-auto sm:flex-none")}
                >
                  {[ALL, ...countries].map((c) => (
                    <option key={c} value={c}>{c === ALL ? "全部地区" : c}</option>
                  ))}
                </select>
                <select
                  value={sort}
                  onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as SortKey }))}
                  aria-label="排序方式"
                  className={cn(CONTROL, "h-11 min-w-0 flex-1 sm:h-8 sm:w-auto sm:flex-none")}
                >
                  {SORTS.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
                <div
                  role="group"
                  aria-label="视图切换"
                  className="flex shrink-0 overflow-hidden rounded-lg border bg-card"
                >
                  <button
                    onClick={() => setFilters((f) => ({ ...f, view: "grid" }))}
                    title="网格视图"
                    aria-label="网格视图"
                    aria-pressed={view === "grid"}
                    className={cn(
                      "flex size-11 items-center justify-center sm:size-8",
                      view === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
                    )}
                  >
                    <LayoutGrid className="size-3.5" />
                  </button>
                  <button
                    onClick={() => setFilters((f) => ({ ...f, view: "list" }))}
                    title="列表视图"
                    aria-label="列表视图"
                    aria-pressed={view === "list"}
                    className={cn(
                      "flex size-11 items-center justify-center sm:size-8",
                      view === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
                    )}
                  >
                    <List className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/*
              Announced, not only drawn: the cards move under every two-second
              push, and for anyone not staring at the grid the count on a chip is
              the entire answer to "did that search do anything".
            */}
            <span role="status" className="sr-only">
              {`匹配 ${filtered.length} 台，共 ${sorted.length} 台`}
            </span>

            {/*
              One situation now, not two: an empty fleet is caught above and
              gets a page of its own. What is left is a filter that excluded
              everything, and the way out of that is a looser filter.
            */}
            {filtered.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                没有符合条件的节点。
                <button className="ml-1 underline" onClick={resetFilters}>清除筛选</button>
              </p>
            ) : view === "grid" ? (
              <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((n: Node) => (
                  <NodeCard
                    key={n.id}
                    node={n}
                    onOpen={openNode}
                    quality={quality.get(n.id)}
                    pending={qualityOn && !quality.has(n.id)}
                  />
                ))}
              </div>
            ) : (
              // Half the gap of the grid: the list view pays for its tighter
              // cards by fitting more of them, and at the grid's spacing it
              // did not.
              <div className="space-y-2">
                {filtered.map((n: Node) => (
                  <NodeCard
                    key={n.id}
                    node={n}
                    onOpen={openNode}
                    list
                    quality={quality.get(n.id)}
                    pending={qualityOn && !quality.has(n.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
