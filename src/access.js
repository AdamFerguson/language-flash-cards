// Cloudflare Access JWT verification (RS256 against the team JWKS).
// Env (plain vars, NOT secrets — the AUD tag and team domain are not secrets):
//   ACCESS_TEAM  team name: the `foo` in foo.cloudflareaccess.com
//   ACCESS_AUD   comma-separated policy AUD tags (rotate in dashboard revokes sessions)
// When ACCESS_AUD is unset the Worker runs in legacy mode (app-code + sid cookie).
const JWKS_TTL = 300e3
let jwksCache = { team: '', at: 0, keys: [] }

export function accessMode(env) {
  return Boolean(env.ACCESS_TEAM && env.ACCESS_AUD)
}

const b64urlJson = (seg) => JSON.parse(atob(seg.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (seg.length % 4)) % 4)))
const b64urlBytes = (seg) => Uint8Array.from(atob(seg.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (seg.length % 4)) % 4)), (c) => c.charCodeAt(0))

async function getKeys(env, fetchImpl) {
  if (jwksCache.team === env.ACCESS_TEAM && jwksCache.keys.length && Date.now() - jwksCache.at < JWKS_TTL) return jwksCache.keys
  const res = await fetchImpl(`https://${env.ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`)
  if (!res.ok) throw new Error(`jwks ${res.status ?? 500}`)
  const { keys } = await res.json()
  if (!keys?.length) throw new Error('jwks empty')
  jwksCache = { team: env.ACCESS_TEAM, at: Date.now(), keys }
  return keys
}

export async function verifyAccessJwt(req, env, fetchImpl = fetch) {
  const token = req.headers.get('CF-Access-Jwt-Assertion') || req.headers.get('cf-access-jwt-assertion')
  if (!token) throw new Error('no-access-jwt')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('malformed-jwt')
  const header = b64urlJson(parts[0])
  const payload = b64urlJson(parts[1])

  const allowedAud = String(env.ACCESS_AUD).split(',').map((s) => s.trim()).filter(Boolean)
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!auds.some((a) => allowedAud.includes(a))) throw new Error('aud-mismatch')
  if (!(payload.exp > Date.now() / 1000)) throw new Error('expired')
  const email = typeof payload.email === 'string' && payload.email.includes('@') ? payload.email : null
  if (!email) throw new Error('no-email-claim')

  const jwk = (await getKeys(env, fetchImpl)).find((k) => k.kid === header.kid)
  if (!jwk) throw new Error('unknown-kid')
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
    b64urlBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1]))
  if (!ok) throw new Error('bad-signature')
  return { email }
}
