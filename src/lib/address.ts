import type { Node } from "@/lib/api"

/**
 * Where a shown address came from, which the detail page prints as its tooltip.
 *
 * `manual` is a value the operator set by hand and outranks everything else;
 * `interface` an address the machine reported on one of its own interfaces;
 * `exit` the address the hub saw the connection arrive from, which for a node
 * behind NAT or a proxy is the only public address it has; `connection` is that
 * same address where the agent reported no interface at all, so there is
 * nothing to prefer it over.
 */
export type AddressSource = "manual" | "interface" | "exit" | "connection"

export type Address = { address: string; source: AddressSource }

/**
 * Globally routable.
 *
 * Kept in step with the hub's own copy, `web-admin/src/lib/api.ts` `isPublic`:
 * the hub picks the interface address it derives a node's country from by these
 * same ranges, so the two lists drifting apart would put a node's flag and the
 * address this page shows on different machines. The empty string is answered
 * here rather than by the caller -- the hub only ever asks about a value it has
 * already checked is non-empty, and nothing is globally routable about "".
 */
export function isPublic(ip: string): boolean {
  if (!ip) return false
  // v6 counts 2000::/3 only, which leaves out ULA and link-local.
  if (ip.includes(":")) return (parseInt(ip.split(":")[0] || "0", 16) & 0xe000) === 0x2000
  // v4 excludes RFC 1918, CGNAT, loopback, link-local, 0/8, 192.0.0/24,
  // 198.18/15 (the fake-IP range of TUN-mode proxies), multicast and reserved.
  const [a, b, c] = ip.split(".").map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)))
}

/**
 * The addresses a node is reached by: at most one per family, v4 first.
 *
 * The hub grew two ways of deciding this that the raw payload does not show, and
 * printing `ip` / `ipv4` / `ipv6` as they arrive let this page describe a node
 * differently from the panel it was configured in. A node whose operator pinned
 * an address showed the automatic one here. A node behind NAT showed the
 * private address on its interface instead of the public one the hub sees it by
 * -- the exact figure an operator is looking for when they open a host to fix
 * it. This is the hub's own rule (`web-admin/src/lib/api.ts` `addresses`),
 * ported so the two pages cannot disagree about the same node.
 *
 * Per family: an address set by hand comes first, then a public one on the
 * machine's own interface. Failing both -- the interface holds only a private
 * address of that family, so the node sits behind NAT or a proxy -- the address
 * the connection arrived from stands in, but only when it is public and of that
 * same family: an exit of the other family is a translator such as NAT64, not
 * this node's address. Private addresses are shown only when nothing public is
 * known at all, as where hub and node share a network and they are all there
 * is. `ip` alone is what remains for an agent reporting no interface.
 */
export function addresses(
  node: Pick<Node, "ip" | "ipv4" | "ipv6" | "ipv4_pin" | "ipv6_pin">,
): Address[] {
  const { ip = "", ipv4 = "", ipv6 = "", ipv4_pin = "", ipv6_pin = "" } = node
  const family = (pin: string, held: string, v6: boolean): Address | null =>
    pin ? { address: pin, source: "manual" }
      : held && isPublic(held) ? { address: held, source: "interface" }
      : held && isPublic(ip) && ip.includes(":") === v6 ? { address: ip, source: "exit" }
      : null
  const shown = [family(ipv4_pin, ipv4, false), family(ipv6_pin, ipv6, true)]
    .filter((a): a is Address => a !== null)
  if (shown.length) return shown
  if (ipv4 || ipv6) {
    return [ipv4, ipv6].filter(Boolean).map((address): Address => ({ address, source: "interface" }))
  }
  return ip ? [{ address: ip, source: "connection" }] : []
}
