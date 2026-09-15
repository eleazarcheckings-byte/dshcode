/**
 * Which address to print on the pairing code. A laptop has several — Wi-Fi,
 * Ethernet, a virtual adapter a container installed — and the phone can only
 * be given one, so the order is deliberate: ordinary private ranges first,
 * link-local and carrier-grade NAT last, virtual adapters after real ones.
 * Every candidate still goes into the certificate, so a person who picks a
 * different one by hand is not locked out.
 */

import { networkInterfaces } from 'node:os'

/** One reachable IPv4 literal and the interface it belongs to. */
export interface LanAddress {
  /** The IPv4 literal. */
  address: string
  /** The operating-system interface name. */
  interface: string
}

/** Addresses a phone on the same network plausibly routes to, best first. */
const PREFERRED = [
  /^192\.168\./u,
  /^10\./u,
  /^172\.(1[6-9]|2\d|3[01])\./u,
]

/** Adapters that exist but rarely carry the household network. */
const VIRTUAL = /^(vEthernet|vboxnet|docker|br-|veth|utun|tailscale|ZeroTier|Hyper-V|WSL|Loopback)/iu

function rank(entry: LanAddress): number {
  const family = PREFERRED.findIndex(pattern => pattern.test(entry.address))
  const base = family === -1 ? PREFERRED.length : family
  return base * 2 + (VIRTUAL.test(entry.interface) ? 1 : 0)
}

/**
 * Every non-internal IPv4 address this host answers on, best candidate first.
 * @param interfaces - injectable interface table; defaults to this host's.
 * @returns the ordered candidates; empty when only loopback exists.
 */
export function lanAddresses(interfaces = networkInterfaces()): LanAddress[] {
  const found: LanAddress[] = []
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      // Node 18 reports the family as the number 4; later versions as 'IPv4'.
      const ipv4 = entry.family === 'IPv4' || (entry.family as unknown as number) === 4
      if (!ipv4 || entry.internal || entry.address.startsWith('169.254.')) continue
      found.push({ address: entry.address, interface: name })
    }
  }
  return found.sort((left, right) => rank(left) - rank(right) || left.address.localeCompare(right.address))
}
