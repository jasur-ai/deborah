/**
 * AUTH C-01 — ASN resolver (per-ASN rate limit tier uchun)
 * ---------------------------------------------------------------------------
 * IP → ASN mapping plaginli: `ASN_DB_PATH` (MaxMind GeoLite2-ASN.mmdb) yoki
 * env `ASN_OVERRIDES` (test/dev uchun: "203.0.113.0/24=64500" formatida).
 * Hech narsa o'rnatilmagan bo'lsa → null (tier skip, fail-open — C-01 §23:
 * ASN DB bo'lmasa per-ASN himoya o'chadi, per-IP/account qoladi).
 *
 * Test injeksiyasi: `setAsnResolver(fn)` — unit/integration testlar.
 */

let resolver = null;

export function setAsnResolver(fn) {
  resolver = typeof fn === 'function' ? fn : null;
}

/**
 * @param {string} ip
 * @returns {Promise<number|null>} ASN raqami yoki null (aniqlanmadi)
 */
export async function resolveAsn(ip) {
  if (resolver) {
    try {
      return await resolver(ip);
    } catch (_) {
      return null;
    }
  }
  if (!ip) return null;
  try {
    // MaxMind GeoLite2-ASN — opsional (operator o'rnatadi)
    const dbPath = process.env.ASN_DB_PATH;
    if (dbPath) {
      const { reader } = await import('@maxmind/geoip2-node').catch(() => ({ reader: null }));
      if (reader) {
        const asn = reader.open(dbPath);
        const res = asn.asi(ip);
        return res && res.autonomousSystemNumber ? Number(res.autonomousSystemNumber) : null;
      }
    }
    // Env override — test/dev: "203.0.113.0/24=64500,10.0.0.0/8=64501"
    const overrides = process.env.ASN_OVERRIDES;
    if (overrides) {
      for (const entry of overrides.split(',')) {
        const [cidr, asnStr] = entry.split('=');
        if (!cidr || !asnStr) continue;
        if (ipInCidr(ip, cidr.trim())) return Number(asnStr);
      }
    }
  } catch (_) { /* fail-open */ }
  return null;
}

/** Oddiy CIDR tekshiruvi (IPv4) — kichik hajmli override'lar uchun. */
export function ipInCidr(ip, cidr) {
  try {
    const [net, bitsStr] = cidr.split('/');
    const bits = parseInt(bitsStr, 10);
    if (!net || Number.isNaN(bits)) return false;
    const ipInt = ipv4ToInt(ip);
    const netInt = ipv4ToInt(net);
    if (ipInt === null || netInt === null) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipInt & mask) === (netInt & mask);
  } catch (_) {
    return false;
  }
}

function ipv4ToInt(ip) {
  const parts = String(ip || '').split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    acc = (acc * 256) + n;
  }
  return acc >>> 0;
}
