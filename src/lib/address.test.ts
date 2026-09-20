import { describe, expect, it } from "vitest"

import { addresses, isPublic } from "@/lib/address"

/*
 * Which address a node is described by.
 *
 * The hub decides this with rules the raw payload does not show -- and it has
 * to agree with the panel the node was configured in, or an operator opens a
 * host here and reads an address that machine does not answer on. Each case
 * below is one of those rules; the hub's own suite (`web-admin/src/lib/api.test.ts`)
 * asserts the same shapes, so the two are to be changed together.
 */

describe("isPublic", () => {
  it("counts only globally routable v4", () => {
    expect(isPublic("203.0.113.9")).toBe(true)
    expect(isPublic("8.8.8.8")).toBe(true)
    for (const private_ of [
      "10.0.0.5", "172.16.4.1", "192.168.1.5", "127.0.0.1", "0.0.0.0", "169.254.1.1",
      // CGNAT: the address a node behind the carrier's own NAT reports.
      "100.64.0.1",
      // The fake-IP range of TUN-mode proxies, and 192.0.0/24.
      "198.18.0.1", "198.19.255.1", "192.0.0.1",
    ]) {
      expect(isPublic(private_), private_).toBe(false)
    }
  })

  it("counts 2000::/3 and nothing else", () => {
    expect(isPublic("2409:8a1e::5")).toBe(true)
    expect(isPublic("2001:db8::1")).toBe(true)
    // ULA and link-local, the two a container or a LAN reports.
    expect(isPublic("fd00::1")).toBe(false)
    expect(isPublic("fe80::1")).toBe(false)
  })

  it("does not call an empty address routable", () => {
    // The hub only asks about a value it has already checked is non-empty; this
    // page has no such guard above it, and `"".split(".")` yields NaN, which
    // every comparison in the range test answers false to.
    expect(isPublic("")).toBe(false)
  })
})

describe("addresses", () => {
  it("falls back to the connection address for an agent reporting no interface", () => {
    expect(addresses({ ip: "203.0.113.47" })).toEqual([
      { address: "203.0.113.47", source: "connection" },
    ])
  })

  it("shows one public interface address per family, v4 first", () => {
    expect(addresses({ ip: "203.0.113.47", ipv4: "198.51.100.4", ipv6: "2001:db8::1" })).toEqual([
      { address: "198.51.100.4", source: "interface" },
      { address: "2001:db8::1", source: "interface" },
    ])
  })

  it("lets a hand-set address outrank the automatic one", () => {
    // The operator pinned this one precisely because the automatic figure is
    // not what the machine answers on; showing the interface's instead is the
    // disagreement this rule exists to prevent.
    expect(addresses({ ipv4_pin: "203.0.113.9", ipv4: "198.51.100.4", ip: "198.51.100.4" }))
      .toEqual([{ address: "203.0.113.9", source: "manual" }])
    expect(addresses({ ipv6_pin: "2409:8a1e::88", ipv6: "2001:db8::1" }))
      .toEqual([{ address: "2409:8a1e::88", source: "manual" }])
  })

  it("stands the public exit in for an interface that only has a private address", () => {
    // NAT: the machine's own interface says 10.x, and the only address anyone
    // can reach it by is the one the connection arrived from.
    expect(addresses({ ip: "203.0.113.47", ipv4: "10.0.0.5" })).toEqual([
      { address: "203.0.113.47", source: "exit" },
    ])
    expect(addresses({ ip: "2409:8a1e::5", ipv6: "fd00::1" })).toEqual([
      { address: "2409:8a1e::5", source: "exit" },
    ])
  })

  it("leaves out an exit of the other family", () => {
    // A v6 connection arriving at a v4-only interface is a translator such as
    // NAT64. Its address is not this node's, and printing it as though it were
    // sends the reader to the translator. The private address is what is left.
    expect(addresses({ ip: "2001:db8::1", ipv4: "10.0.0.5" })).toEqual([
      { address: "10.0.0.5", source: "interface" },
    ])
  })

  it("shows a private address only when nothing public is known", () => {
    // Hub and node on one network, where the private address is all there is.
    expect(addresses({ ipv4: "192.168.1.5" })).toEqual([
      { address: "192.168.1.5", source: "interface" },
    ])
  })

  it("says nothing for a visitor who was never sent an address", () => {
    expect(addresses({})).toEqual([])
    expect(addresses({ ip: "", ipv4: "", ipv6: "" })).toEqual([])
  })
})
