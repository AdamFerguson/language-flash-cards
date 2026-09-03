import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyAccessJwt, accessMode } from '../src/access.js'

const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'])
const jwk = { ...await crypto.subtle.exportKey('jwk', publicKey), kid: 'key-1', alg: 'RS256', use: 'sig' }

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const enc = (o) => b64(new TextEncoder().encode(JSON.stringify(o)))

async function signJwt(payload, { kid = 'key-1' } = {}) {
  const h = enc({ alg: 'RS256', kid, typ: 'JWT' })
  const p = enc(payload)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(h + '.' + p))
  return `${h}.${p}.${b64(sig)}`
}
const reqWith = (token) => ({ headers: new Headers(token ? { 'cf-access-jwt-assertion': token } : {}) })
const fetchOk = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) })
const future = Math.floor(Date.now() / 1000) + 3600
const env = { ACCESS_TEAM: 'testteam', ACCESS_AUD: 'aud-abc,aud-def' }

test('accessMode off without env', () => {
  assert.equal(accessMode({}), false)
  assert.equal(accessMode({ ACCESS_TEAM: 't' }), false)
  assert.equal(accessMode({ ACCESS_TEAM: 't', ACCESS_AUD: 'a' }), true)
})

test('valid jwt returns email', async () => {
  const t = await signJwt({ aud: 'aud-abc', exp: future, email: 'someone@example.com' })
  assert.deepEqual(await verifyAccessJwt(reqWith(t), env, fetchOk), { email: 'someone@example.com' })
})

test('second AUD tag accepted', async () => {
  const t = await signJwt({ aud: ['aud-def'], exp: future, email: 'a@b.cc' })
  assert.equal((await verifyAccessJwt(reqWith(t), env, fetchOk)).email, 'a@b.cc')
})

test('foreign AUD rejected', async () => {
  const t = await signJwt({ aud: 'other-app-aud', exp: future, email: 'a@b.cc' })
  await assert.rejects(verifyAccessJwt(reqWith(t), env, fetchOk), /aud-mismatch/)
})

test('expired rejected', async () => {
  const t = await signJwt({ aud: 'aud-abc', exp: Math.floor(Date.now() / 1000) - 60, email: 'a@b.cc' })
  await assert.rejects(verifyAccessJwt(reqWith(t), env, fetchOk), /expired/)
})

test('tampered signature rejected', async () => {
  const t = await signJwt({ aud: 'aud-abc', exp: future, email: 'a@b.cc' })
  const [h, p, s] = t.split('.')
  const evil = enc({ aud: 'aud-abc', exp: future, email: 'attacker@evil.cc' })
  await assert.rejects(verifyAccessJwt(reqWith(`${h}.${evil}.${s}`), env, fetchOk), /bad-signature/)
})

test('unknown kid rejected', async () => {
  const t = await signJwt({ aud: 'aud-abc', exp: future, email: 'a@b.cc' }, { kid: 'rotated-key' })
  await assert.rejects(verifyAccessJwt(reqWith(t), env, fetchOk), /unknown-kid/)
})

test('missing / malformed tokens rejected', async () => {
  await assert.rejects(verifyAccessJwt(reqWith(null), env, fetchOk), /no-access-jwt/)
  await assert.rejects(verifyAccessJwt(reqWith('garbage'), env, fetchOk), /malformed-jwt|Cannot/)
})

test('no email claim rejected', async () => {
  const t = await signJwt({ aud: 'aud-abc', exp: future })
  await assert.rejects(verifyAccessJwt(reqWith(t), env, fetchOk), /no-email-claim/)
})

test('jwks endpoint failure rejects (fail closed)', async () => {
  const t = await signJwt({ aud: 'aud-abc', exp: future, email: 'a@b.cc' })
  // force a cache miss by pointing at a different team name
  await assert.rejects(
    verifyAccessJwt(reqWith(t), { ...env, ACCESS_TEAM: 'otherteam' }, async () => ({ ok: false, status: 500, json: async () => ({}) })),
    /jwks 500/)
})
