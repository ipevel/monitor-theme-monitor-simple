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
      [{ metrics: null, metrics_invalid: true }, /数据不可用/],
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

  it("is memoised", () => {
    // The data layer goes to considerable trouble to hand back the same node
    // object on a tick where nothing moved. Without this one line that work
    // is wasted, and the failure is silent: everything still looks right.
    expect(typeof NodeCard).toBe("object")
  })
})
