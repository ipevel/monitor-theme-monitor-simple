import { cleanup, render, screen } from "@testing-library/react"

import { afterEach, describe, expect, it } from "vitest"

import { NodeCard } from "@/components/NodeCard"
import type { Node } from "@/lib/api"

/*
 * What a card draws.
 *
 * These are the three things no unit test over src/lib can see: which words a
 * state produces, whether the rail is there, and whether the dot beside the
 * status line contradicts it. Everything else about the card -- its numbers,
 * its thresholds, its formatting -- belongs to the suites next door.
 */

const GiB = 1024 ** 3

function make(over: Record<string, unknown> = {}): Node {
  return {
    id: 1,
    name: "tokyo-01",
    country: "JP",
    online: true,
    cpu_cores: 2,
    mem_total: 8 * GiB,
    disk_total: 100 * GiB,
    last_seen: Math.floor(Date.now() / 1000),
    ...over,
  } as unknown as Node
}

function metrics(over: Record<string, unknown> = {}): NonNullable<Node["metrics"]> {
  return {
    cpu: 8,
    mem_used: 2 * GiB,
    disk_used: 40 * GiB,
    net_rx: 0,
    net_tx: 0,
    load: [0.4, 0.4, 0.4],
    ...over,
  } as unknown as NonNullable<Node["metrics"]>
}

afterEach(cleanup)

describe("NodeCard", () => {
  it("names each of the five states in words", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ metrics: metrics() }, /在线/],
      [{ metrics: null }, /已接入 · 等待数据/],
      [{ metrics: null, metrics_invalid: true }, /数据异常/],
      [{ online: false }, /离线/],
      [{ online: false, cpu_cores: 0, mem_total: 0 }, /未接入/],
    ]
    for (const [over, want] of cases) {
      const { unmount } = render(<NodeCard node={make(over)} onOpen={() => {}} />)
      expect(screen.getByText(want)).toBeTruthy()
      unmount()
    }
  })

  it("draws a rail only when something is wrong", () => {
    // Not `[aria-hidden]`: the flag's own svg is hidden from a screen reader
    // too, and every card with a country has one.
    const quiet = render(<NodeCard node={make({ metrics: metrics() })} onOpen={() => {}} />)
    expect(quiet.container.querySelector("span.rounded-r-full")).toBeNull()
    quiet.unmount()

    const hot = render(<NodeCard node={make({ metrics: metrics({ cpu: 95 }) })} onOpen={() => {}} />)
    expect(hot.container.querySelector("span.rounded-r-full")?.className).toContain("bg-destructive")
  })

  it("does not also say 'fine' in green beside an alert", () => {
    // A card at 95% CPU used to carry a red rail and a green dot at once: two
    // answers to one question, given at the same volume. The dot means the
    // agent is reporting, which a burning node can be doing perfectly.
    const { container } = render(
      <NodeCard node={make({ metrics: metrics({ cpu: 95 }) })} onOpen={() => {}} />,
    )
    const dots = [...container.querySelectorAll("span.rounded-full")]
    expect(dots.some((d) => d.className.includes("bg-ok"))).toBe(false)
  })

  it("keeps the dot green where nothing is wrong", () => {
    const { container } = render(<NodeCard node={make({ metrics: metrics() })} onOpen={() => {}} />)
    const dots = [...container.querySelectorAll("span.rounded-full")]
    expect(dots.some((d) => d.className.includes("bg-ok"))).toBe(true)
  })

  it("marks an alerting node's dot as muted, not green", () => {
    // The previous test proves the green is gone. This one proves what is
    // there instead: without it, "no green" would also pass on a card that
    // dropped the dot altogether.
    const { container } = render(
      <NodeCard node={make({ metrics: metrics({ cpu: 95 }) })} onOpen={() => {}} />,
    )
    const dots = [...container.querySelectorAll("span.rounded-full")]
    expect(dots.some((d) => d.className.includes("bg-muted-foreground"))).toBe(true)
  })

  it("says when a reading is being measured rather than showing nothing", () => {
    // The switch fires requests in batches of six; for a second or two the
    // cards that have not been reached yet look exactly like cards whose probe
    // failed.
    const { unmount } = render(<NodeCard node={make({ metrics: metrics() })} onOpen={() => {}} pending />)
    expect(screen.getByText("测量中…")).toBeTruthy()
    unmount()

    render(<NodeCard node={make({ metrics: metrics() })} onOpen={() => {}} />)
    expect(screen.queryByText("测量中…")).toBeNull()
  })

  it("is a memo, which is the only thing that makes the data layer's care worth anything", () => {
    /*
     * The data layer goes to considerable trouble to hand back the same node
     * object on a tick where nothing moved. That work is wasted without this
     * line, and the failure is silent -- everything still looks right.
     *
     * `typeof === "object"` was what stood here before, and it is not a test:
     * forwardRef, lazy and any plain object all pass it too. The symbol names
     * what it is. Counting renders instead was tried and abandoned -- a
     * Profiler fires on its own second mount, so that assertion passed with
     * the memo removed, which is worse than no test at all.
     */
    expect(NodeCard).toHaveProperty("$$typeof", Symbol.for("react.memo"))
  })
})

describe("NodeCard rate line", () => {
  /**
   * These two figures were arriving on every two-second push and being read by
   * nothing but the detail page's chart, so "which host is actually moving
   * traffic" cost a click per node to answer.
   */
  it("prints what the link is doing now", () => {
    render(
      <NodeCard
        node={make({ metrics: metrics({ net_rx: 2 * 1024 ** 2, net_tx: 512 * 1024 }) })}
        onOpen={() => {}}
      />,
    )
    // ArrowDown/ArrowUp are icons with aria-hidden; the visible text is the value alone.
    expect(screen.getByText(/2\.0 MB\/s/)).toBeTruthy()
    expect(screen.getByText(/512\.0 KB\/s/)).toBeTruthy()
  })

  it("says nothing rather than printing a rate of zero it was never sent", () => {
    render(<NodeCard node={make({ metrics: metrics({ net_rx: null, net_tx: null }) })} onOpen={() => {}} />)
    // Rate values end with "/s" (B/s, KB/s, MB/s). None should appear.
    expect(screen.queryByText(/\/s/)).toBeNull()
  })

  it("lights the rate line while traffic moves and keeps it quiet at rest", () => {
    // A rate has no threshold, so it never wears an alert colour -- but "is
    // this host moving anything right now" still deserves one visible step.
    const moving = render(
      <NodeCard node={make({ metrics: metrics({ net_rx: 2 * 1024 ** 2, net_tx: 0 }) })} onOpen={() => {}} />,
    )
    const row = screen.getByText(/2\.0 MB\/s/).closest("div")
    expect(row?.className).toContain("text-muted-foreground")
    moving.unmount()

    render(<NodeCard node={make({ metrics: metrics({ net_rx: 0, net_tx: 0 }) })} onOpen={() => {}} />)
    // Both directions print "0 B/s"; either row carries the quiet tone.
    const rest = screen.getAllByText(/0 B\/s/)[0].closest("div")
    expect(rest?.className).toContain("text-muted-2")
  })
})

describe("NodeCard metric rails", () => {
  it("draws half-height rails for load and swap", () => {
    const { container } = render(
      <NodeCard
        node={make({ metrics: metrics({ swap_total: 2 * GiB, swap_used: GiB }) })}
        onOpen={() => {}}
      />,
    )
    // MiniRail: 2px tall, 56px track. One for load, one for swap.
    expect(container.querySelectorAll("span.h-0\\.5.w-14").length).toBe(2)
  })

  it("skips the swap rail when the box reports no swap", () => {
    const { container } = render(<NodeCard node={make({ metrics: metrics() })} onOpen={() => {}} />)
    expect(container.querySelectorAll("span.h-0\\.5.w-14").length).toBe(1)
  })

  it("colours a saturated rail with the alert tone", () => {
    // Swap at 100% crosses DANGER_AT; the rail fill must say so at a glance.
    const { container } = render(
      <NodeCard
        node={make({ metrics: metrics({ swap_total: 2 * GiB, swap_used: 2 * GiB }) })}
        onOpen={() => {}}
      />,
    )
    const fills = [...container.querySelectorAll("span.h-0\\.5.w-14 > span")]
    expect(fills.some((f) => f.className.includes("bg-destructive"))).toBe(true)
  })

  it("draws the month rail only where a traffic cap exists", () => {
    const capped = render(
      <NodeCard
        node={make({ metrics: metrics(), traffic_limit: 100 * GiB, month_used: 50 * GiB })}
        onOpen={() => {}}
      />,
    )
    // MonthRail sits on `mb-1.5`; the three big readings use `mt-1.5`.
    expect(capped.container.querySelectorAll("div.mb-1\\.5.h-1").length).toBe(1)
    capped.unmount()

    const unlimited = render(<NodeCard node={make({ metrics: metrics() })} onOpen={() => {}} />)
    expect(unlimited.container.querySelectorAll("div.mb-1\\.5.h-1").length).toBe(0)
  })
})
