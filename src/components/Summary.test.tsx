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

})

/*
 * The fifth cell: how many renewals are close, and when the first of them is.
 * The strip used to say "7 天内到期" and nothing else, which answered "is
 * anything due" with a yes and left "does it need doing today" unanswered.
 */
describe("Summary, the expiring cell", () => {
  const inDays = (n: number) => {
    const d = new Date(Date.now() + n * 86400000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  }

  it("names the soonest renewal rather than a spread of days", () => {
    render(
      <Summary
        nodes={[
          make({ expires_at: inDays(6), price: 5, currency: "CNY" }),
          make({ id: 2, expires_at: inDays(0), price: 5, currency: "CNY" }),
        ]}
        onExpiring={vi.fn()}
        onAlerting={vi.fn()}
      />,
    )
    // Two are due within the week; the one that decides what happens today is
    // today's, not the total and not the average.
    expect(screen.getByText("2 台")).toBeTruthy()
    expect(screen.getByText(/今天到期/)).toBeTruthy()
  })

  it("totals only what shares a currency, and says so otherwise", () => {
    const { unmount } = render(
      <Summary
        nodes={[
          make({ expires_at: inDays(2), price: 5, currency: "CNY" }),
          make({ id: 2, expires_at: inDays(3), price: 10, currency: "CNY" }),
        ]}
        onExpiring={vi.fn()}
        onAlerting={vi.fn()}
      />,
    )
    expect(screen.getByText(/合计/)).toBeTruthy()
    unmount()

    render(
      <Summary
        nodes={[make({ expires_at: inDays(2), price: 0, currency: "CNY" })]}
        onExpiring={vi.fn()}
        onAlerting={vi.fn()}
      />,
    )
    // Free nodes are still renewals worth knowing about; pretending they cost
    // nothing to total would leave the cell with an empty note.
    expect(screen.getByText(/含免费节点/)).toBeTruthy()
  })

  it("opens the expiring filter", () => {
    const onExpiring = vi.fn()
    render(
      <Summary
        nodes={[make({ expires_at: inDays(2), price: 5, currency: "CNY" })]}
        onExpiring={onExpiring}
        onAlerting={vi.fn()}
      />,
    )
    const cell = screen.getByRole("button", { name: /即将到期/ }) as HTMLButtonElement
    expect(cell.disabled).toBe(false)
    fireEvent.click(cell)
    expect(onExpiring).toHaveBeenCalledTimes(1)
  })

  it("is a memo, so a quiet tick does not rerun four reduce passes", () => {
    // Same reasoning as the card's: the fleet object comes back unchanged on
    // most ticks, and `typeof === "object"` proved nothing about that.
    expect(Summary).toHaveProperty("$$typeof", Symbol.for("react.memo"))
  })
})
