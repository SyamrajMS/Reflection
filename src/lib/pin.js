const PIN_STORAGE_KEY = 'reflection.pinHash.v1'
const PIN_SALT_KEY = 'reflection.pinSalt.v1'

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function getSalt() {
  let salt = localStorage.getItem(PIN_SALT_KEY)

  if (!salt) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    salt = toHex(bytes)
    localStorage.setItem(PIN_SALT_KEY, salt)
  }

  return salt
}

export function hasPin() {
  return Boolean(localStorage.getItem(PIN_STORAGE_KEY))
}

export async function hashPin(pin) {
  const encoder = new TextEncoder()
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${getSalt()}:${pin}`),
  )

  return toHex(digest)
}

export async function setPin(pin) {
  localStorage.setItem(PIN_STORAGE_KEY, await hashPin(pin))
}

export async function verifyPin(pin) {
  const stored = localStorage.getItem(PIN_STORAGE_KEY)
  return stored === (await hashPin(pin))
}
