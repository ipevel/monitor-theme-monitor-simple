import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { LayoutGrid, List, Moon, Search, Sun, Wrench } from "lucide-react"

import { NodeCard } from "@/components/NodeCard"
import { Summary } from "@/components/Summary"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api, useNodes, type Node } from "@/lib/api"
import { cn } from "@/lib/utils"

type Me = { authed: boolean; github: boolean; site_name: string; public_page: boolean }

const loadDetail = () => import("@/components/NodeDetail").then((m) => ({ default: m.NodeDetail }))
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
  return [
    id,
    (next: number | null) => {
      history.pushState({}, "", next === null ? "/" : `/node/${next}`)
      setId(next)
      scrollTo(0, 0)
    },
  ] as const
}

function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("nvidia-theme")
    return saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches
  })
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    localStorage.setItem("nvidia-theme", dark ? "dark" : "light")
  }, [dark])
  return [dark, () => setDark((d) => !d)] as const
}

// 从节点名提取场景分类: 建站/入口集群/ix互联/落地服务器
function categoryOf(node: Node): string {
  const name = node.name
  if (/建站|网站|web|hosting/i.test(name)) return "建站"
  if (/入口|集群|edge|ingress/i.test(name)) return "入口集群"
  if (/ix|互联/i.test(name)) return "ix互联"
  if (/落地/i.test(name)) return "落地服务器"
  return "全部节点"
}

function daysUntil(date?: string | null): number | null {
  if (!date) return null
  const target = new Date(`${date}T00:00:00`).getTime()
  if (Number.isNaN(target)) return null
  return Math.ceil((target - Date.now()) / 86400000)
}

export default function App() {
  const [dark, toggleTheme] = useTheme()
  const [me, setMe] = useState<Me | null>(null)
  const [meError, setMeError] = useState("")
  const { nodes, error, closed } = useNodes()
  const [open, go] = useNodeRoute()
  const [category, setCategory] = useState("全部节点")
  const [status, setStatus] = useState("全部")
  const [query, setQuery] = useState("")
  const [view, setView] = useState<"grid" | "list">("grid")

  const loadMe = useCallback(() => {
    return api<Me>("/me")
      .then((next) => { setMe(next); setMeError("") })
      .catch((e: Error) => setMeError(e.message || "网络错误"))
  }, [])

  useEffect(() => {
    loadMe()
    void loadDetail()
  }, [loadMe])

  useEffect(() => {
    if (closed) void loadMe()
  }, [closed, loadMe])

  useEffect(() => {
    if (me && !me.public_page && !me.authed) location.href = "/admin/"
  }, [me])

  const sorted = useMemo(() => [...(nodes ?? [])].sort((a, b) => a.sort - b.sort || a.id - b.id), [nodes])
  const selected = sorted.find((n) => n.id === open)

  useEffect(() => {
    document.title = [selected?.name, me?.site_name || "Monitor"].filter(Boolean).join(" · ")
  }, [selected?.name, me?.site_name])

  // 分类列表 (从节点名提取)
  const categories = useMemo(() => {
    const set = new Set<string>()
    sorted.forEach((n) => set.add(categoryOf(n)))
    return ["全部节点", ...set].filter((c) => c !== "全部节点" || set.size === 0)
  }, [sorted])

  // 状态筛选
  const offlineCount = sorted.filter((n) => !n.online && (n.cpu_cores > 0 || n.mem_total > 0)).length
  const expiringCount = sorted.filter((n) => {
    const d = daysUntil(n.expires_at)
    return d !== null && d >= 0 && d <= 7
  }).length
  const unconnectedCount = sorted.filter((n) => !(n.cpu_cores > 0 || n.mem_total > 0)).length

  const statusTabs = [
    { key: "全部", label: "全部节点" },
    { key: "离线", label: `离线 ${offlineCount}` },
    { key: "即将到期", label: `即将到期 ${expiringCount}` },
    { key: "未接入", label: `未接入 ${unconnectedCount}` },
  ]

  // 过滤
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return sorted.filter((n) => {
      if (status === "离线" && (n.online || !(n.cpu_cores > 0 || n.mem_total > 0))) return false
      if (status === "即将到期") {
        const d = daysUntil(n.expires_at)
        if (d === null || d < 0 || d > 7) return false
      }
      if (status === "未接入" && (n.cpu_cores > 0 || n.mem_total > 0)) return false
      if (category !== "全部节点" && categoryOf(n) !== category) return false
      if (needle && ![n.name, n.ip, n.ipv4, n.ipv6].some((v) => v?.toLowerCase().includes(needle))) return false
      return true
    })
  }, [sorted, status, category, query])

  if (!me) return (
    <div className="grid min-h-svh place-items-center p-6 text-sm text-muted-foreground">
      {meError ? <div className="space-y-3 text-center"><p role="alert">加载失败：{meError}</p><Button onClick={loadMe}>重试</Button></div> : "加载中…"}
    </div>
  )

  if (!me.public_page && !me.authed) return null

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
          <button className="font-semibold transition-opacity hover:opacity-70" onClick={() => go(null)}>
            {me.site_name || "Monitor"}
          </button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" asChild>
            <a href="/admin/">
              <Wrench /> {me.authed ? "进入后台" : "登录"}
            </a>
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleTheme} title="切换主题">
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-4 sm:px-6">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {open !== null ? (
          !nodes ? (
            <Skeleton className="h-96" />
          ) : selected ? (
            <Suspense fallback={<Skeleton className="h-96" />}>
              <NodeDetail node={selected} />
            </Suspense>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              节点不存在或未公开。<button className="underline" onClick={() => go(null)}>返回列表</button>
            </p>
          )
        ) : !nodes ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-72" />
            ))}
          </div>
        ) : (
          <>
            <Summary nodes={sorted} />

            {/* 筛选栏 */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1">
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs transition-colors",
                      category === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <div className="flex gap-1">
                {statusTabs.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setStatus(s.key)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs transition-colors",
                      status === s.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索节点"
                  className="h-8 w-40 rounded-md border bg-transparent pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus:border-ring sm:w-48"
                />
              </div>
              <div className="flex overflow-hidden rounded-md border">
                <button
                  onClick={() => setView("grid")}
                  title="网格视图"
                  className={cn("p-1.5", view === "grid" ? "bg-muted text-foreground" : "text-muted-foreground")}
                >
                  <LayoutGrid className="size-3.5" />
                </button>
                <button
                  onClick={() => setView("list")}
                  title="列表视图"
                  className={cn("p-1.5", view === "list" ? "bg-muted text-foreground" : "text-muted-foreground")}
                >
                  <List className="size-3.5" />
                </button>
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">没有符合条件的节点</p>
            ) : view === "grid" ? (
              <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((n: Node) => (
                  <NodeCard key={n.id} node={n} onOpen={() => go(n.id)} />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((n: Node) => (
                  <NodeCard key={n.id} node={n} onOpen={() => go(n.id)} list />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
