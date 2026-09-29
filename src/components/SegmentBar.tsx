import { cn } from "@/lib/utils"
import { severity } from "@/lib/severity"

/*
 * 分段计量条：目标稿的核心视觉元素。
 *
 * 为什么是分段而不是连续填充：目标设计用一条由等宽小块组成的轨道表达占用率，
 * 每一块代表 1/16 的容量。等宽块让「八成满」和「九成满」在一屏内可以被一眼
 * 数出来，而连续条在 300px 宽、2px 高的尺度上只能读出「差不多」。
 *
 * 段数规则（定稿）：段数 = round(百分比 × 16)，至少 1 段（只要大于 0），
 * 至多 16 段。这个规则必须集中在一处，否则卡片与详情页会对同一个 76.53%
 * 画出不同的格数——那比不画更糟。
 *
 * 配色分两层，这是与目标稿最大的偏离，也是刻意为之：
 *   1. 读数正常时用「指标标识色」(--metric-*)，四个指标各一个色相，
 *      让一列卡片可以按位置加颜色一起读；这些色相不承载状态含义。
 *   2. 读数越过 80% / 92% 阈值时，整条切换为 warn / destructive，
 *      与这个主题既有的「颜色只留给两种告警」契约保持一致。
 * 所以：颜色在静默时是身份，在越线时是告警——两者不会互相冒充。
 *
 * 无障碍：条本身 aria-hidden（它是一个重复表达，精确值就在旁边的数字里），
 * 但每段之间有 1px 间隙，不依赖颜色区分——色盲用户数格数即可读出量级。
 */

/** 一格代表 1/16 容量。规则集中在这里，卡片与详情页共用。 */
export const SEGMENTS = 16

export type MetricKey = "cpu" | "mem" | "disk" | "load" | "traffic"

const METRIC_FILL: Record<MetricKey, string> = {
  cpu: "bg-metric-cpu",
  mem: "bg-metric-mem",
  disk: "bg-metric-disk",
  load: "bg-metric-load",
  traffic: "bg-metric-traffic",
}

/**
 * 段数换算。
 *
 * 用 round 而不是 floor：目标稿的 76.53% 画的是 12 段，只有四舍五入能得到
 * (0.7653 × 16 = 12.24)。floor 会把刚过整格的读数画少一格，在一排卡片里
 * 显得比实际更空。非有限值与负数一律 0 段，任何 >0 的值至少 1 段——一个
 * 显示为「完全空」但其实是 3% 的条会撒谎。
 */
export function segmentCount(pct: number | null): number {
  if (pct === null || !Number.isFinite(pct) || pct <= 0) return 0
  const filled = Math.round((Math.min(pct, 100) / 100) * SEGMENTS)
  return Math.max(1, Math.min(SEGMENTS, filled))
}

/**
 * 一条分段计量条。
 *
 * `dim` 用于读数过期或缺失的节点：整条降为背景灰，与卡片上行文字的降级一致，
 * 让「没有数据」不会伪装成「用量很低」。
 */
export function SegmentBar({
  pct,
  metric,
  dim = false,
  className,
  segments = SEGMENTS,
}: {
  pct: number | null
  metric: MetricKey
  dim?: boolean
  className?: string
  /** 允许调用方在窄容器里减少格数，但换算规则仍由 segmentCount 给出。 */
  segments?: number
}) {
  const count = segmentCount(pct)
  const filled = segments === SEGMENTS ? count : Math.round((count / SEGMENTS) * segments)
  const level = severity(pct)
  const fill = dim
    ? "bg-muted-foreground/30"
    : level === "danger"
      ? "bg-destructive"
      : level === "warn"
        ? "bg-warn"
        : METRIC_FILL[metric]

  return (
    <div
      aria-hidden="true"
      className={cn("flex w-full items-stretch gap-px", className)}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-full min-w-0 flex-1 rounded-[1px]",
            i < filled ? fill : "bg-muted",
          )}
        />
      ))}
    </div>
  )
}
