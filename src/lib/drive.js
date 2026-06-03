import { serializeMessage } from './db'
import { encryptData, decryptData } from './crypto'

const DISCOVERY_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const STATE_FILE_NAME = 'journal_state.json'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

let tokenClient
let token
let scriptPromise

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = resolve
    script.onerror = () => reject(new Error('Could not load Google Identity Services.'))
    document.head.append(script)
  })

  return scriptPromise
}

async function request(path, options = {}) {
  if (!token) throw new Error('Connect Google Drive first.')

  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `Google Drive request failed: ${response.status}`)
  }

  return response
}

export async function connectDrive() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('Set VITE_GOOGLE_CLIENT_ID in .env.local.')

  await loadGoogleIdentityScript()

  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DISCOVERY_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error))
          return
        }

        token = response.access_token
        resolve(token)
      },
    })

    tokenClient.requestAccessToken({ prompt: '' })
  })
}

export function isDriveConnected() {
  return Boolean(token)
}

export async function findStateFile() {
  const query = encodeURIComponent(
    `name='${STATE_FILE_NAME}' and 'appDataFolder' in parents and trashed=false`,
  )
  const fields = encodeURIComponent('files(id,name,modifiedTime)')
  const response = await request(`${DRIVE_FILES_URL}?spaces=appDataFolder&q=${query}&fields=${fields}`)
  const data = await response.json()
  return data.files?.[0] ?? null
}

export async function downloadState(sessionKey) {
  const stateFile = await findStateFile()
  if (!stateFile) return null

  const response = await request(`${DRIVE_FILES_URL}/${stateFile.id}?alt=media`)
  const rawBlob = await response.blob()
  
  try {
    return await decryptData(rawBlob, sessionKey, 'json')
  } catch (err) {
    // Fallback if older plain JSON backup
    const text = await rawBlob.text()
    return JSON.parse(text)
  }
}

export async function downloadMedia(fileId, sessionKey) {
  const response = await request(`${DRIVE_FILES_URL}/${fileId}?alt=media`)
  const rawBlob = await response.blob()
  
  try {
    return await decryptData(rawBlob, sessionKey, 'blob')
  } catch (err) {
    return rawBlob
  }
}

async function uploadMultipart({ fileId, metadata, body, mimeType }) {
  const boundary = `reflection-${crypto.randomUUID()}`
  const formBody = new Blob(
    [
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\n`,
      `Content-Type: ${mimeType}\r\n\r\n`,
      body,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  )
  const method = fileId ? 'PATCH' : 'POST'
  const url = fileId
    ? `${DRIVE_UPLOAD_URL}/${fileId}?uploadType=multipart`
    : `${DRIVE_UPLOAD_URL}?uploadType=multipart`
  const response = await request(url, {
    method,
    headers: { 'Content-Type': formBody.type },
    body: formBody,
  })

  return response.json()
}

export async function uploadMedia(message, sessionKey) {
  if (!message.blob) return message.driveFileId

  const encryptedBlob = await encryptData(message.blob, sessionKey)

  const uploaded = await uploadMultipart({
    fileId: message.driveFileId,
    metadata: {
      name: `${message.id}.${message.type === 'audio' ? 'webm' : 'jpg'}`,
      parents: message.driveFileId ? undefined : ['appDataFolder'],
    },
    body: encryptedBlob,
    mimeType: 'application/octet-stream',
  })

  return uploaded.id
}

export async function uploadState(messages, sessionKey) {
  const stateFile = await findStateFile()
  
  // Organize cleanly
  const payload = {
    version: 2,
    encrypted: true,
    updatedAt: new Date().toISOString(),
    messages: messages.map(serializeMessage).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
  }

  const encryptedBlob = await encryptData(payload, sessionKey)

  return uploadMultipart({
    fileId: stateFile?.id,
    metadata: {
      name: STATE_FILE_NAME,
      parents: stateFile ? undefined : ['appDataFolder'],
    },
    body: encryptedBlob,
    mimeType: 'application/octet-stream',
  })
}
