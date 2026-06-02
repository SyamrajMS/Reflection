export function formatTime(isoDate) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(isoDate))
}

export function formatDateHeader(isoDate) {
  const date = new Date(isoDate)
  const today = new Date()
  const yesterday = new Date()

  today.setHours(0, 0, 0, 0)
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(0, 0, 0, 0)

  const messageDay = new Date(date)
  messageDay.setHours(0, 0, 0, 0)

  if (messageDay.getTime() === today.getTime()) return 'Today'
  if (messageDay.getTime() === yesterday.getTime()) return 'Yesterday'

  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date)
}

export function groupMessagesByDate(messages) {
  return messages.reduce((groups, message) => {
    const key = new Date(message.createdAt).toDateString()
    const last = groups.at(-1)

    if (last?.key === key) {
      last.messages.push(message)
    } else {
      groups.push({ key, label: formatDateHeader(message.createdAt), messages: [message] })
    }

    return groups
  }, [])
}
