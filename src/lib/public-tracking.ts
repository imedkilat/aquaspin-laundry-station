const TOKEN_PREFIX = 'v1'
const TOKEN_SCOPE = 'aquaspin:public-order-tracking:v1:'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PUBLIC_ORDER_STATUSES = new Set(['received', 'washing', 'drying', 'ready_for_pickup', 'completed', 'on_hold'])

export type PublicTrackingStatus = {
  transaction_code: string
  order_status: string
}

export type PublicTrackingLookupResult =
  | { found: true; transaction_code: string; order_status: string }
  | { found: false }

export function canIssuePublicTrackingLink(profile: { role?: unknown; is_active?: unknown } | null): boolean {
  return Boolean(profile?.is_active === true && (profile.role === 'owner' || profile.role === 'staff'))
}

function parseSecret(secretHex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(secretHex)) return null
  return Uint8Array.from(secretHex.match(/.{2}/g)!, (byte) => Number.parseInt(byte, 16))
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!SIGNATURE_PATTERN.test(value)) return null
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '=')
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function importHmacKey(secretHex: string): Promise<CryptoKey | null> {
  const secret = parseSecret(secretHex)
  if (!secret) return null
  return crypto.subtle.importKey('raw', asArrayBuffer(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function createPublicTrackingToken(transactionId: string, secretHex: string): Promise<string | null> {
  if (!UUID_PATTERN.test(transactionId)) return null
  const key = await importHmacKey(secretHex)
  if (!key) return null
  const message = new TextEncoder().encode(`${TOKEN_SCOPE}${transactionId.toLowerCase()}`)
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
  return `${TOKEN_PREFIX}.${transactionId.toLowerCase()}.${toBase64Url(signature)}`
}

export async function verifyPublicTrackingToken(token: string, secretHex: string): Promise<string | null> {
  if (typeof token !== 'string' || token.length > 100) return null
  const [version, transactionId, signature, extra] = token.split('.')
  if (
    version !== TOKEN_PREFIX || extra !== undefined ||
    !UUID_PATTERN.test(transactionId ?? '') || !SIGNATURE_PATTERN.test(signature ?? '')
  ) return null

  const key = await importHmacKey(secretHex)
  const signatureBytes = fromBase64Url(signature)
  if (!key || !signatureBytes) return null

  const message = new TextEncoder().encode(`${TOKEN_SCOPE}${transactionId.toLowerCase()}`)
  const valid = await crypto.subtle.verify('HMAC', key, asArrayBuffer(signatureBytes), asArrayBuffer(message))
  return valid ? transactionId.toLowerCase() : null
}

/** Build the only fields that may leave the tracking endpoint. */
export function toPublicTrackingStatus(row: Record<string, unknown> | null): PublicTrackingStatus | null {
  if (
    !row || typeof row.transaction_code !== 'string' || typeof row.order_status !== 'string' ||
    !PUBLIC_ORDER_STATUSES.has(row.order_status)
  ) return null
  return {
    transaction_code: row.transaction_code,
    order_status: row.order_status,
  }
}

export async function lookupPublicTrackingStatus(
  token: string,
  secretHex: string,
  readOrder: (transactionId: string) => Promise<Record<string, unknown> | null>,
): Promise<PublicTrackingLookupResult> {
  const transactionId = await verifyPublicTrackingToken(token, secretHex)
  if (!transactionId) return { found: false }

  const row = await readOrder(transactionId)
  if (!row || row.deleted_at || row.order_status === 'cancelled') return { found: false }

  const status = toPublicTrackingStatus(row)
  return status ? { found: true, ...status } : { found: false }
}
