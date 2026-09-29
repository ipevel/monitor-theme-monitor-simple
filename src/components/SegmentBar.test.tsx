import { cleanup, render } from "@testing-library/react"

import { afterEach, describe, expect, it } from "vitest"

import { NodeCard } from "@/components/NodeCard"
import { SEGMENTS, segmentCount } from "@/components/SegmentBar"
import type { Node } from "@/lib/api"

/*
 * 分段计量条的取整规则，以及卡片按新信息架构渲染的断言。
 *
 * 这是视觉验收角色点名要求的回归项：目标稿的分段条一旦落地，段数规则就成了一份
 * 契约——同一个 76.53%，卡片、详情页、以及未来任何调用方都必须画出同样的格数。
 * 规则本身（round(pct x 16)）在这里逐值锁定，任何"顺手改成 floor"的改动都会红。
 */

afterEach(cleanup)

const GiB = 1024 ** 3

function make(overrides: Partial<Node> = {}): Node {
  return {
    id: 1,
    name: "test-node",
    online: true,
    cpu_cores: 2,
    ...overrides,
  } as Node
}

function metrics(overrides: Record<string, unknown> = {}) {
  return {
    cpu: 10,
    mem_used: GiB,
    mem_total: 4 * GiB,
    disk_used: GiB,
    disk_total: 10 * GiB,
    load: [0.2],
    net_rx: 1024,
    net_tx: 2048,
    ...overrides,
  } as unknown as Node["metrics"]
}

describe("segmentCount", () => {
  it("rounds to the nearest cell rather than flooring", () => {
    // The target design's own reading: 76.53% draws twelve cells, which only
    // rounding produces (0.7653 x 16 = 12.24). Floor would draw eleven and make
    // the node look emptier than it is in a column of cards.
    expect(segmentCount(76.53)).toBe(12)
    expect(segmentCount(11.71)).toBe(2)
    expect(segmentCount(63.2)).toBe(10)
  })

  it("never draws an empty bar for a non-zero reading", () => {
    // A 0.4% reading rounds to 0 cells, and a bar that says "completely empty"
    // about a machine using disk is a lie the eye believes.
    expect(segmentCount(0.4)).toBe(1)
    expect(segmentCount(0.01)).toBe(1)
  })

  it("fills every cell at and above full", () => {
    expect(segmentCount(100)).toBe(SEGMENTS)
    expect(segmentCount(140)).toBe(SEGMENTS)
  })

  it("draws nothing for a missing or unusable reading", () => {
    expect(segmentCount(null)).toBe(0)
    expect(segmentCount(Number.NaN)).toBe(0)
    expect(segmentCount(Number.POSITIVE_INFINITY)).toBe(0)
    expect(segmentCount(-5)).toBe(0)
    expect(segmentCount(0)).toBe(0)
  })

  it("is monotonic, so a fuller reading never draws fewer cells", () => {
    let prev = 0
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const n = segmentCount(pct)
      expect(n).toBeGreaterThanOrEqual(prev)
      prev = n
    }
  })
})

describe("the card's segmented meters", () => {
  it("draws one 16-cell meter per reading, four readings on the grid", () => {
    const { container } = render(
      <NodeCard node={make({ metrics: metrics() })} onOpen={() => {}} />,
    )
    // Each meter is a flex row of cells; the four readings are CPU, 内存, 硬盘,
    // 负载. Identified by the aria-hidden wrapper every SegmentBar renders.
    const meters = container.querySelectorAll('div[aria-hidden="true"].flex.w-full')
    expect(meters.length).toBe(4)
    for (const meter of meters) {
      expect(meter.children.length).toBe(SEGMENTS)
    }
  })

  it("paints a normal reading with its metric's identity hue, not an alert tone", () => {
    const { container } = render(
      <NodeCard node={make({ metrics: metrics({ cpu: 12 }) })} onOpen={() => {}} />,
    )
    const cells = [...container.querySelectorAll('div[aria-hidden="true"].flex.w-full > span')]
    // CPU at 12% is two cells of identity blue; the rest is the muted track.
    expect(cells.some((c) => c.className.includes("bg-metric-cpu"))).toBe(true)
    expect(cells.some((c) => c.className.includes("bg-warn"))).toBe(false)
    expect(cells.some((c) => c.className.includes("bg-destructive"))).toBe(false)
  })

  it("switches the whole meter to the alert tone once a reading crosses 80%", () => {
    const { container } = render(
      <NodeCard node={make({ metrics: metrics({ cpu: 95 }) })} onOpen={() => {}} />,
    )
    const cells = [...container.querySelectorAll('div[aria-hidden="true"].flex.w-full > span')]
    expect(cells.some((c) => c.className.includes("bg-destructive"))).toBe(true)
    // Colour must mean the alert here, so the identity hue is gone entirely.
    expect(cells.some((c) => c.className.includes("bg-metric-cpu"))).toBe(false)
  })

  it("dims every meter on a node whose sample is stale", () => {
    const { container } = render(
      <NodeCard node={make({ online: false, metrics: metrics() })} onOpen={() => {}} />,
    )
    const cells = [...container.querySelectorAll('div[aria-hidden="true"].flex.w-full > span')]
    // The dim fill is `bg-muted-foreground/30`, which CONTAINS the substring
    // `bg-muted` -- so the empty track is matched by exact class, not by a
    // substring test that would swallow the dim fill too.
    const filled = cells.filter((c) => c.classList.contains("bg-muted-foreground/30"))
    const track = cells.filter((c) => c.classList.contains("bg-muted"))
    expect(filled.length).toBeGreaterThan(0)
    // No identity hue and no alert tone survives on a stale node.
    expect(cells.some((c) => c.className.includes("bg-metric-"))).toBe(false)
    expect(track.length).toBeGreaterThan(0)
  })
})

describe("the card's 2x2 metric grid", () => {
  it("shows all four labels including 负载", () => {
    const { container } = render(
      <NodeCard node={make({ metrics: metrics() })} onOpen={() => {}} />,
    )
    for (const label of ["CPU", "内存", "硬盘", "负载"]) {
      expect(container.textContent, `missing ${label}`).toContain(label)
    }
  })

  it("states load against the core count, not as a bare average", () => {
    const { container } = render(
      <NodeCard node={make({ cpu_cores: 4, metrics: metrics({ load: [1.2] }) })} onOpen={() => {}} />,
    )
    // 1.2 on four cores is 30%: the raw figure an operator quotes plus the
    // denominator that makes it readable.
    expect(container.textContent).toContain("1.20 / 4 核")
  })
})
