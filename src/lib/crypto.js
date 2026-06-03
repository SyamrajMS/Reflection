import { getSalt as getV1Salt } from './pin'

// Helper to convert hex to array buffer
function hexToArrayBuffer(hex) {
  const bytes = new Uint8Array(Math.ceil(hex.length / 2))
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes.buffer
}

// Internal deriveKey that takes a specific saltBuffer
async function deriveKeyWithSalt(pin, saltBuffer) {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

const MAGIC_HEADER = new TextEncoder().encode('REF2')

export async function encryptData(data, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKeyWithSalt(pin, salt.buffer)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  
  let encodedData
  if (typeof data === 'string') {
    encodedData = new TextEncoder().encode(data)
  } else if (data instanceof Blob) {
    encodedData = new Uint8Array(await data.arrayBuffer())
  } else {
    encodedData = new TextEncoder().encode(JSON.stringify(data))
  }

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encodedData
  )

  // Payload: [4 bytes MAGIC] [16 bytes Salt] [12 bytes IV] [Encrypted]
  const payload = new Uint8Array(MAGIC_HEADER.length + salt.length + iv.length + encrypted.byteLength)
  payload.set(MAGIC_HEADER, 0)
  payload.set(salt, MAGIC_HEADER.length)
  payload.set(iv, MAGIC_HEADER.length + salt.length)
  payload.set(new Uint8Array(encrypted), MAGIC_HEADER.length + salt.length + iv.length)

  return new Blob([payload], { type: 'application/octet-stream' })
}

export async function decryptData(blob, pin, type = 'json') {
  const buffer = await blob.arrayBuffer()
  const view = new Uint8Array(buffer)

  let key
  let iv
  let data

  // Check for MAGIC_HEADER 'REF2'
  let isV2 = view.length >= 4
  if (isV2) {
    for (let i = 0; i < MAGIC_HEADER.length; i++) {
      if (view[i] !== MAGIC_HEADER[i]) {
        isV2 = false
        break
      }
    }
  }

  if (isV2) {
    // V2 Format: [4 bytes MAGIC] [16 bytes Salt] [12 bytes IV] [Encrypted]
    const salt = view.slice(4, 20)
    iv = view.slice(20, 32)
    data = view.slice(32)
    key = await deriveKeyWithSalt(pin, salt.buffer)
  } else {
    // V1 Format: [12 bytes IV] [Encrypted]
    // Uses the local localStorage salt
    const v1SaltHex = getV1Salt()
    const v1SaltBuffer = hexToArrayBuffer(v1SaltHex)
    key = await deriveKeyWithSalt(pin, v1SaltBuffer)
    iv = view.slice(0, 12)
    data = view.slice(12)
  }

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  )

  if (type === 'json') {
    const jsonString = new TextDecoder().decode(decryptedBuffer)
    return JSON.parse(jsonString)
  } else if (type === 'blob') {
    return new Blob([decryptedBuffer])
  } else {
    return new TextDecoder().decode(decryptedBuffer)
  }
}
