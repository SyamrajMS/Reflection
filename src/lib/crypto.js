import { getSalt } from './pin'

function hexToArrayBuffer(hex) {
  const bytes = new Uint8Array(Math.ceil(hex.length / 2))
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes.buffer
}

export async function deriveKey(pin) {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  )

  const saltBuffer = hexToArrayBuffer(getSalt())

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

export async function encryptData(data, key) {
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

  const payload = new Uint8Array(iv.length + encrypted.byteLength)
  payload.set(iv, 0)
  payload.set(new Uint8Array(encrypted), iv.length)

  return new Blob([payload], { type: 'application/octet-stream' })
}

export async function decryptData(blob, key, type = 'json') {
  const buffer = await blob.arrayBuffer()
  const iv = new Uint8Array(buffer.slice(0, 12))
  const data = new Uint8Array(buffer.slice(12))

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
