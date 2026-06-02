import Dexie from 'dexie'

export const db = new Dexie('reflection-journal')

db.version(1).stores({
  messages: '&id, createdAt, type, driveFileId, syncStatus',
  meta: '&key',
})

export async function getAllMessages() {
  return db.messages.orderBy('createdAt').toArray()
}

export async function saveMessage(message) {
  const storedMessage = { ...message }
  delete storedMessage.objectUrl

  await db.messages.put({
    ...storedMessage,
    updatedAt: message.updatedAt ?? new Date().toISOString(),
    syncStatus: message.syncStatus ?? 'pending',
  })
}

export async function replaceMessages(messages) {
  await db.transaction('rw', db.messages, async () => {
    await db.messages.clear()
    await db.messages.bulkPut(messages)
  })
}

export async function updateMessage(id, patch) {
  await db.messages.update(id, {
    ...patch,
    updatedAt: new Date().toISOString(),
    syncStatus: patch.syncStatus !== undefined ? patch.syncStatus : 'pending',
  })
}

export async function deleteMessage(id) {
  await updateMessage(id, {
    type: 'deleted',
    blob: undefined,
    text: undefined,
    mediaName: undefined,
    mimeType: undefined,
    mediaSize: undefined,
  })
}

export function serializeMessage(message) {
  const jsonSafe = { ...message }
  delete jsonSafe.blob
  delete jsonSafe.objectUrl

  return jsonSafe
}

export async function setMeta(key, value) {
  await db.meta.put({ key, value })
}

export async function getMeta(key) {
  const row = await db.meta.get(key)
  return row?.value
}
