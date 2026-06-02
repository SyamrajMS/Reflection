const IMAGE_MAX_WIDTH = 1600
const IMAGE_QUALITY = 0.72

export async function compressImage(file) {
  const bitmap = await createImageBitmap(file)
  const ratio = Math.min(1, IMAGE_MAX_WIDTH / bitmap.width)
  const width = Math.max(1, Math.round(bitmap.width * ratio))
  const height = Math.max(1, Math.round(bitmap.height * ratio))
  const canvas = document.createElement('canvas')

  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not compress image.'))
          return
        }

        resolve(blob)
      },
      'image/jpeg',
      IMAGE_QUALITY,
    )
  })
}

export function makeObjectUrl(message) {
  if (!message.blob) return null
  return URL.createObjectURL(message.blob)
}

export function supportsVoiceRecording() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder)
}

export async function createVoiceRecorder(onComplete) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'
  const chunks = []
  const recorder = new MediaRecorder(stream, {
    mimeType,
    audioBitsPerSecond: 16000,
  })

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  recorder.onstop = () => {
    stream.getTracks().forEach((track) => track.stop())
    onComplete(new Blob(chunks, { type: mimeType }))
  }

  return recorder
}

export function formatBytes(size = 0) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
