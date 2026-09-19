import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { afterEach, describe, expect, it } from "vitest"

import { hiddenFor, Identity } from "@/components/NodeDetail"
import type { Node } from "@/lib/api"

/*
 * Which probes a detail view has hidden, and on which host.
 *
 * Everything else in NodeDetail needs a chart, a fetch and a ResizeObserver
 * before it can say anything, so this is the one thing in there worth testing
 * on its own: the list is per-host, and probe numbers are reused across hosts.
 * Hiding probe 1 in Tokyo used to blank the only line on a host in Frankfurt
 * while the legend underneath still listed every probe -- an empty chart that
 * looked like a fetch that had failed.
 *
 * The view is keyed on the host as well now, so this is the second line of
 * defence rather than the first; it is cheap and it is the one that says what
 * the rule actually is.
 */
describe("hiddenFor", () => {
  it("returns the ids that belong to this host", () => {
    expect(hiddenFor({ node: 7, ids: [1, 3] }, 7)).toEqual([1, 3])
  })

  it("returns nothing for a different host", () => {
    expect(hiddenFor({ node: 7, ids: [1, 3] }, 9)).toEqual([])
  })

  it("returns nothing when nothing has been hidden yet", () => {
    expect(hiddenFor({ node: 7, ids: [] }, 7)).toEqual([])
  })
})

afterEach(cleanup)

/*
 * The address on a public panel.
 *
 * The panel is one shared link away from being public, and an address is the
 * one field on it that points straight at a machine. What prints by default is
 * the prefix; the rest is one click away and the click is not remembered.
 */
describe("Identity", () => {
  const host = (over: Partial<Node> = {}): Node => ({
    id: 1,
    name: "tokyo-01",
    hostname: "tokyo-01",
    ip: "203.0.113.47",
    ...over,
  } as unknown as Node)

  it("prints the network and not the host", () => {
    render(<Identity node={host()} />)
    expect(screen.getByText("203.0.*.*")).toBeTruthy()
    expect(screen.queryByText("203.0.113.47")).toBeNull()
  })

  it("shows the whole address when asked, and takes it back", () => {
    render(<Identity node={host()} />)
    fireEvent.click(screen.getByRole("button", { name: "显示" }))
    expect(screen.getByText("203.0.113.47")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "隐藏" }))
    expect(screen.getByText("203.0.*.*")).toBeTruthy()
  })

  it("says nothing at all for a visitor who was never sent an address", () => {
    const { container } = render(
      <Identity node={host({ hostname: undefined, ip: undefined })} />,
    )
    expect(container.textContent).toBe("")
  })

  it("masks each of the three address fields", () => {
    render(<Identity node={host({ ipv4: "198.51.100.4", ipv6: "2001:db8::1" })} />)
    expect(screen.getByText("198.51.*.*")).toBeTruthy()
    expect(screen.getByText("2001:db8::*")).toBeTruthy()
  })
})
