import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Summary } from "@/components/Summary"
import type { Node } from "@/lib/api"

/*
 * The overview strip's clickable cells.
 *
 * Whether a cell can be opened is decided by the data, and the wrong answer is
 * invisible: a cell that looks clickable and is not, or one that is a <div>
 * half the time and a <button> the rest of it.
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
    month_rx: 0,
    month_tx: 0,
    day_rx: 0,
    day_tx: 0,
    price: 0,
    currency: "CNY",
    billing_cycle: "monthly",
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

describe("Summary", () => {
  it("is a button that does nothing when there is nothing to open", () => {
    render(
      <Summary nodes={[make({ metrics: metrics() })]} onExpiring={vi.fn()} onAlerting={vi.fn()} />,
    )
    const cell = screen.getByRole("button", { name: /告警/ }) as HTMLButtonElement
    // A <div> here instead would make the strip change shape as the fleet
    // changes -- every cell shifting by the height of a tag name.
    expect(cell.tagName).toBe("BUTTON")
    expect(cell.disabled).toBe(true)
  })

  it("opens the alert filter when there is something to open", () => {
    const onAlerting = vi.fn()
    render(
      <Summary
        nodes={[make({ metrics: metrics({ cpu: 95 }) })]}
        onExpiring={vi.fn()}
        onAlerting={onAlerting}
      />,
    )
    const cell = screen.getByRole("button", { name: /告警/ }) as HTMLButtonElement
    expect(cell.disabled).toBe(false)
    fireEvent.click(cell)
    expect(onAlerting).toHaveBeenCalledTimes(1)
  })

  it("names an unreadable node as what it is, not as over a threshold", () => {
    render(
      <Summary
        nodes={[make({ metrics: null, metrics_invalid: true })]}
        onExpiring={vi.fn()}
        onAlerting={vi.fn()}
      />,
    )
    // Counted as alerting -- a node whose data cannot be read is something to
    // look at -- but "数据异常" is not "超限", and folding the two together
    // told someone to go and reduce load on a machine they cannot see.
    expect(screen.getByText(/台数据异常/)).toBeTruthy()
  })

  it("is memoised", () => {
    expect(typeof Summary).toBe("object")
  })
})
