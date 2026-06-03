import { useState, useRef, useEffect, useMemo } from 'react'
import EmojiPicker from 'emoji-picker-react'
import {
  Ban,
  CheckCheck,
  ChevronDown,
  Cloud,
  Image as ImageIcon,
  Loader2,
  Lock,
  Mic,
  Paperclip,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Smile,
  StopCircle,
  X,
} from 'lucide-react'
import {
  db,
  deleteMessage,
  getAllMessages,
  replaceMessages,
  saveMessage,
  updateMessage,
} from './lib/db'
import { groupMessagesByDate, formatTime } from './lib/date'
import {
  compressImage,
  createVoiceRecorder,
  formatBytes,
  makeObjectUrl,
  supportsVoiceRecording,
} from './lib/media'
import { connectDrive, downloadMedia, downloadState, isDriveConnected, uploadMedia, uploadState } from './lib/drive'
import { hasPin, setPin, verifyPin } from './lib/pin'
import { AudioPlayer } from './components/AudioPlayer'

const USER_NAME = 'My Journal'
const QUICK_REACTIONS = ['💡', '❤️', '👍', '😢']
const emojiOnlyRegex = /^[\p{Emoji}\s]+$/u
const isEmojiOnly = (text) => text?.trim().length > 0 && emojiOnlyRegex.test(text.trim())

function normalizeMessage(message) {
  return {
    ...message,
    objectUrl: makeObjectUrl(message),
  }
}

function revokeUrls(messages) {
  messages.forEach((message) => {
    if (message.objectUrl) URL.revokeObjectURL(message.objectUrl)
  })
}

function App() {
  const [locked, setLocked] = useState(true)
  const [pinReady, setPinReady] = useState(() => hasPin())
  const [pinInput, setPinInput] = useState('')
  const [sessionKey, setSessionKey] = useState(null)
  const [pinError, setPinError] = useState('')
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [syncState, setSyncState] = useState('offline')
  const [syncLabel, setSyncLabel] = useState('Drive disconnected')
  const [searchMode, setSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchReactionFilter, setSearchReactionFilter] = useState(null)
  const [searchEmojiPickerOpen, setSearchEmojiPickerOpen] = useState(false)
  const [activeDropdown, setActiveDropdown] = useState(null)
  const [activeReactionMenu, setActiveReactionMenu] = useState(null)
  const [reactionPickerOpen, setReactionPickerOpen] = useState(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const recorderRef = useRef(null)
  const cameraInputRef = useRef(null)
  const attachmentInputRef = useRef(null)
  const scrollRef = useRef(null)
  const emojiPanelRef = useRef(null)
  const messagesRef = useRef([])
  const longPressTimerRef = useRef(null)

  useEffect(() => {
    return () => revokeUrls(messagesRef.current)
  }, [])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    if (locked) return undefined

    let cancelled = false

    getAllMessages().then((rows) => {
      if (cancelled) return
      setMessages(rows.map(normalizeMessage))
      if (isInitialLoad) {
        setTimeout(() => scrollRef.current?.scrollIntoView(), 50)
        setIsInitialLoad(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [locked, isInitialLoad])

  function scrollToBottom() {
    setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  useEffect(() => {
    function handleClickOutside(event) {
      if (emojiOpen && emojiPanelRef.current && !emojiPanelRef.current.contains(event.target) && !event.target.closest('.emoji-toggle-btn')) {
        setEmojiOpen(false)
      }
      if (reactionPickerOpen && emojiPanelRef.current && !emojiPanelRef.current.contains(event.target)) {
        setReactionPickerOpen(null)
      }
      if (searchEmojiPickerOpen && emojiPanelRef.current && !emojiPanelRef.current.contains(event.target) && !event.target.closest('.search-filter-btn')) {
        setSearchEmojiPickerOpen(false)
      }
      if (activeDropdown && !event.target.closest('.message-dropdown-container')) {
        setActiveDropdown(null)
      }
      if (activeReactionMenu && !event.target.closest('.message-dropdown-container')) {
        setActiveReactionMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [emojiOpen, activeDropdown, activeReactionMenu, reactionPickerOpen, searchEmojiPickerOpen])

  const groupedMessages = useMemo(() => {
    const groups = groupMessagesByDate(messages)
    if (!searchQuery && !searchReactionFilter) return groups

    const q = searchQuery.toLowerCase()
    return groups.map(group => {
      const dateMatch = group.label.toLowerCase().includes(q)
      const filtered = group.messages.filter(m => {
        const textMatch = q ? (dateMatch || m.text?.toLowerCase().includes(q)) : true
        const reactionMatch = searchReactionFilter ? m.reaction === searchReactionFilter : true
        return textMatch && reactionMatch
      })
      return { ...group, messages: filtered }
    }).filter(group => group.messages.length > 0)
  }, [messages, searchQuery, searchReactionFilter])

  async function handleUnlock(event) {
    event.preventDefault()

    if (pinInput.length < 4) {
      setPinError('Use at least 4 digits or characters.')
      return
    }

    if (!pinReady) {
      await setPin(pinInput)
      setPinReady(true)
      setLocked(false)
      setSessionKey(pinInput)
      setPinInput('')
      setPinError('')
      return
    }

    if (await verifyPin(pinInput)) {
      setLocked(false)
      setSessionKey(pinInput)
      setPinInput('')
      setPinError('')
    } else {
      setPinError('Incorrect PIN or password.')
    }
  }

  async function addMessage(partial) {
    const message = normalizeMessage({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending',
      ...partial,
    })

    await saveMessage(message)
    setMessages((current) => [...current, message])
    scrollToBottom()
  }

  function handlePointerDown(id) {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = setTimeout(() => {
      setActiveReactionMenu(id)
      setActiveDropdown(null)
    }, 500)
  }

  function handlePointerUp() {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
  }

  async function handleReact(id, emoji) {
    if (emoji) {
      await updateMessage(id, { reaction: emoji })
      setMessages(prev => prev.map(m => m.id === id ? { ...m, reaction: emoji } : m))
    } else {
      await updateMessage(id, { reaction: null })
      setMessages(prev => prev.map(m => m.id === id ? { ...m, reaction: null } : m))
    }
    setActiveReactionMenu(null)
    setReactionPickerOpen(null)
  }

  async function handleSend(event) {
    event?.preventDefault()
    const text = draft.trim()
    if (!text) return

    setDraft('')
    setEmojiOpen(false)
    await addMessage({ type: 'text', text })
  }

  async function handleImageChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setSyncLabel('Compressing image locally...')
    const blob = await compressImage(file)
    await addMessage({
      type: 'image',
      blob,
      mimeType: blob.type,
      mediaName: file.name,
      mediaSize: blob.size,
    })
    setSyncLabel(`Image saved locally (${formatBytes(blob.size)})`)
  }

  async function startRecording() {
    if (!supportsVoiceRecording() || recording) return

    const recorder = await createVoiceRecorder(async (blob) => {
      setRecording(false)
      await addMessage({
        type: 'audio',
        blob,
        mimeType: blob.type,
        mediaName: `Voice note ${new Date().toLocaleTimeString()}`,
        mediaSize: blob.size,
      })
      setSyncLabel(`Voice note saved locally (${formatBytes(blob.size)})`)
    })

    recorderRef.current = recorder
    setRecording(true)
    setSyncLabel('Recording at 16 kbps Opus...')
    recorder.start()
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
  }

  async function handleDriveRestore() {
    if (syncState === 'syncing') return
    try {
      setSyncState('syncing')
      setSyncLabel('Connecting to Google Drive...')
      await connectDrive()

      setSyncLabel('Checking appDataFolder backup...')
      const state = await downloadState(sessionKey)
      if (!state?.messages?.length) {
        setSyncState('online')
        setSyncLabel('Drive connected. No backup found yet.')
        return
      }

      setSyncLabel(`Restoring ${state.messages.length} messages...`)
      const restored = await Promise.all(
        state.messages.map(async (message) => {
          if (!message.driveFileId || message.type === 'text') return message

          const blob = await downloadMedia(message.driveFileId, sessionKey)
          return {
            ...message,
            blob,
            mimeType: message.mimeType || blob.type,
            syncStatus: 'synced',
          }
        }),
      )

      await replaceMessages(restored)
      revokeUrls(messages)
      setMessages(restored.map(normalizeMessage))
      setSyncState('online')
      setSyncLabel(`Restored ${restored.length} messages from Drive`)
    } catch (error) {
      setSyncState('error')
      setSyncLabel(error.message)
    }
  }

  async function handleDriveSync() {
    if (syncState === 'syncing') return
    try {
      setSyncState('syncing')

      if (!isDriveConnected()) {
        setSyncLabel('Connecting to Google Drive...')
        await connectDrive()
      }

      setSyncLabel('Checking appDataFolder...')
      const state = await downloadState(sessionKey)
      let cloudMessages = state?.messages || []

      const rows = await db.messages.orderBy('createdAt').toArray()
      const localMap = new Map(rows.map(m => [m.id, m]))

      let downloadedCount = 0
      for (const cm of cloudMessages) {
        let finalCm = { ...cm, syncStatus: 'synced' }
        if (!localMap.has(cm.id)) {
          if ((cm.type === 'image' || cm.type === 'audio') && cm.driveFileId) {
             setSyncLabel('Downloading media...')
             const rawBlob = await downloadMedia(cm.driveFileId, sessionKey)
             if (rawBlob) finalCm.blob = rawBlob
          }
          await saveMessage(finalCm)
          downloadedCount++
        } else {
          const localMessage = localMap.get(cm.id)
          if (new Date(cm.updatedAt) > new Date(localMessage.updatedAt) && localMessage.syncStatus !== 'pending') {
            await updateMessage(cm.id, finalCm)
            downloadedCount++
          }
        }
      }

      for (const m of rows) {
        if ((m.type === 'image' || m.type === 'audio') && m.driveFileId && !m.blob) {
          setSyncLabel('Fetching missing media...')
          const rawBlob = await downloadMedia(m.driveFileId, sessionKey)
          if (rawBlob) {
            await updateMessage(m.id, { blob: rawBlob })
            downloadedCount++
          }
        }
      }

      const updatedRows = await db.messages.orderBy('createdAt').toArray()
      const pendingMessages = updatedRows.filter(m => m.syncStatus === 'pending')

      if (pendingMessages.length === 0) {
        const finalRows = await db.messages.orderBy('createdAt').toArray()
        revokeUrls(messages)
        setMessages(finalRows.map(normalizeMessage))

        setSyncState('online')
        setSyncLabel(downloadedCount > 0 ? `Downloaded ${downloadedCount} items` : 'Everything is up to date')
        return
      }

      const uploaded = []
      let i = 1
      for (const message of pendingMessages) {
        setSyncLabel(`Syncing ${i}/${pendingMessages.length}...`)
        if ((message.type === 'image' || message.type === 'audio') && message.blob) {
          const driveFileId = await uploadMedia(message, sessionKey)
          await updateMessage(message.id, { driveFileId, syncStatus: 'synced' })
          uploaded.push({ ...message, driveFileId, syncStatus: 'synced' })
        } else {
          uploaded.push({ ...message, syncStatus: 'synced' })
          await updateMessage(message.id, { syncStatus: 'synced' })
        }
        i++
      }

      const allMessages = [...cloudMessages.filter(cm => !uploaded.find(u => u.id === cm.id)), ...uploaded]

      setSyncLabel('Encrypting and saving backup...')
      await uploadState(allMessages, sessionKey)

      const finalRows = await db.messages.orderBy('createdAt').toArray()
      revokeUrls(messages)
      setMessages(finalRows.map(normalizeMessage))
      setSyncState('online')
      setSyncLabel(`Synced: ${downloadedCount} down, ${uploaded.length} up`)
    } catch (error) {
      setSyncState('error')
      setSyncLabel(error.message)
    }
  }

  return (
    <main className="app-shell">
      <section className={`phone-frame ${locked ? 'is-locked' : ''}`} aria-label="Reflection journal">
        <header className="chat-header" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {searchMode ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', borderRadius: '20px', padding: '4px 14px', height: '40px', marginTop: '4px' }}>
                <Search size={18} color="#54656f" />
                <input
                  autoFocus
                  style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', fontSize: '15px' }}
                  placeholder="Search text or date..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <button onClick={() => { setSearchMode(false); setSearchQuery(''); setSearchReactionFilter(null); }} style={{ background: 'transparent', color: '#54656f', cursor: 'pointer' }}>
                  <X size={18} />
                </button>
              </div>
              <div className="search-filters">
                <button
                  className={`search-filter-btn ${searchReactionFilter === null ? 'active' : ''}`}
                  onClick={() => setSearchReactionFilter(null)}
                >All</button>
                {QUICK_REACTIONS.map(emoji => (
                  <button
                    key={emoji}
                    className={`search-filter-btn ${searchReactionFilter === emoji ? 'active' : ''}`}
                    onClick={() => setSearchReactionFilter(emoji === searchReactionFilter ? null : emoji)}
                  >{emoji}</button>
                ))}
                {searchReactionFilter && !QUICK_REACTIONS.includes(searchReactionFilter) && (
                  <button
                    className="search-filter-btn active"
                    onClick={() => setSearchReactionFilter(null)}
                  >{searchReactionFilter}</button>
                )}
                <button
                  className={`search-filter-btn ${searchEmojiPickerOpen ? 'active' : ''}`}
                  onClick={() => setSearchEmojiPickerOpen(!searchEmojiPickerOpen)}
                >
                  <Plus size={14} style={{ display: 'inline' }} />
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
              <div className="avatar" aria-hidden="true">
                R
              </div>
              <div className="chat-title">
                <h1>{USER_NAME}</h1>
                <p>{locked ? 'Locked' : syncLabel}</p>
              </div>
              <button className="icon-button" type="button" aria-label="Search messages" onClick={() => setSearchMode(true)}>
                <Search size={20} />
              </button>
              <button className="icon-button" type="button" aria-label="Sync to Google Drive" onClick={handleDriveSync} disabled={syncState === 'syncing'}>
                {syncState === 'syncing' ? <Loader2 size={20} className="animate-spin" /> : <Cloud size={20} />}
              </button>
            </div>
          )}
        </header>

        <div className="chat-surface">
          {groupedMessages.length === 0 && !locked ? (
            <div className="empty-thread">
              <ShieldCheck size={28} />
              <p>Your journal is stored locally first. Connect Drive whenever you want backup or restore.</p>
            </div>
          ) : null}

          {groupedMessages.map((group) => (
            <div key={group.key} className="message-group">
              <div className="date-chip">{group.label}</div>
              {group.messages.map((message) => (
                <article
                  key={message.id}
                  className="bubble sent-bubble message-dropdown-container"
                  onPointerDown={() => handlePointerDown(message.id)}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                >
                  {message.type !== 'deleted' && (
                    <button className="message-dropdown-btn" onClick={() => setActiveDropdown(activeDropdown === message.id ? null : message.id)}>
                      <ChevronDown size={18} />
                    </button>
                  )}

                  {activeDropdown === message.id && (
                    <div className="message-dropdown-menu">
                      <button onClick={async () => {
                        if (window.confirm("Delete this message?")) {
                          await deleteMessage(message.id);
                          setMessages(prev => prev.map(m => m.id === message.id ? { ...m, type: 'deleted' } : m));
                        }
                        setActiveDropdown(null);
                      }}>Delete message</button>
                      {message.type === 'text' && (
                        <button onClick={() => {
                          navigator.clipboard.writeText(message.text);
                          setActiveDropdown(null);
                        }}>Copy</button>
                      )}
                    </div>
                  )}

                  {activeReactionMenu === message.id && (
                    <div className="reaction-menu">
                      {QUICK_REACTIONS.map(emoji => (
                        <button key={emoji} className="reaction-btn" onClick={() => handleReact(message.id, emoji)}>{emoji}</button>
                      ))}
                      <button className="reaction-btn" onClick={() => setReactionPickerOpen(message.id)}>
                        <Plus size={18} color="#54656f" />
                      </button>
                    </div>
                  )}

                  {message.type === 'deleted' ? (
                    <p className="message-text deleted"><Ban size={14} /> This message was deleted</p>
                  ) : (
                    <>
                      {message.type === 'text' && (
                        <p className={`message-text ${isEmojiOnly(message.text) ? 'emoji-only' : ''}`}>
                          {message.text}
                        </p>
                      )}
                      {message.type === 'image' && (
                        <img className="message-image" src={message.objectUrl} alt={message.mediaName || 'Journal upload'} />
                      )}
                      {message.type === 'audio' && (
                        <AudioPlayer src={message.objectUrl} />
                      )}
                    </>
                  )}
                  <footer className="message-meta">
                    <span>{formatTime(message.createdAt)}</span>
                    {message.type !== 'deleted' && <CheckCheck size={15} />}
                  </footer>

                  {message.reaction && (
                    <div className="reaction-badge" onClick={() => handleReact(message.id, null)}>{message.reaction}</div>
                  )}
                </article>
              ))}
            </div>
          ))}
          <div ref={scrollRef} />
        </div>

        <form className="composer" onSubmit={handleSend}>
          {(emojiOpen || reactionPickerOpen || searchEmojiPickerOpen) ? (
            <div className="emoji-panel" ref={emojiPanelRef}>
              <EmojiPicker
                height={360}
                width="100%"
                previewConfig={{ showPreview: false }}
                autoFocusSearch={false}
                onEmojiClick={(emoji) => {
                  if (reactionPickerOpen) {
                    handleReact(reactionPickerOpen, emoji.emoji)
                  } else if (searchEmojiPickerOpen) {
                    setSearchReactionFilter(emoji.emoji)
                    setSearchEmojiPickerOpen(false)
                  } else {
                    setDraft((value) => `${value}${emoji.emoji}`)
                  }
                }}
              />
            </div>
          ) : null}

          <button className="composer-button emoji-toggle-btn" type="button" aria-label="Choose emoji" onClick={() => {
            setEmojiOpen((open) => !open)
            setReactionPickerOpen(null)
          }}>
            <Smile size={22} />
          </button>
          <input
            ref={cameraInputRef}
            className="sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleImageChange}
          />
          <input
            ref={attachmentInputRef}
            className="sr-only"
            type="file"
            accept="image/*"
            onChange={handleImageChange}
          />
          <button className="composer-button" type="button" aria-label="Attach image" onClick={() => attachmentInputRef.current?.click()}>
            <Paperclip size={21} />
          </button>
          <label className="composer-input">
            <button type="button" aria-label="Take photo" onClick={() => cameraInputRef.current?.click()} style={{ background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <ImageIcon size={18} color="#54656f" />
            </button>
            <textarea
              value={draft}
              placeholder="Message"
              aria-label="Journal message"
              onChange={(event) => setDraft(event.target.value)}
              rows={1}
            />
          </label>
          {draft.trim() ? (
            <button className="send-button" type="submit" aria-label="Send message">
              <Send size={20} />
            </button>
          ) : (
            <button
              className={`send-button ${recording ? 'recording' : ''}`}
              type="button"
              style={{ touchAction: 'none' }}
              aria-label={recording ? 'Stop recording' : 'Hold to record voice note'}
              onPointerDown={startRecording}
              onPointerUp={stopRecording}
              onPointerCancel={stopRecording}
              onClick={(event) => event.preventDefault()}
            >
              {recording ? <StopCircle size={22} /> : <Mic size={21} />}
            </button>
          )}
        </form>
      </section>

      {locked ? (
        <section className="lock-screen" aria-label="Local lock screen">
          <form className="lock-panel" onSubmit={handleUnlock}>
            <div className="lock-icon">
              <Lock size={28} />
            </div>
            <h2>{pinReady ? 'Unlock Reflection' : 'Create Local PIN'}</h2>
            <p>
              {pinReady
                ? 'Enter your PIN or password to reveal the journal.'
                : 'This hash is stored locally and protects the app on launch.'}
            </p>
            <input
              autoFocus
              value={pinInput}
              type="password"
              inputMode="numeric"
              placeholder={pinReady ? 'PIN or password' : 'New PIN or password'}
              onChange={(event) => setPinInput(event.target.value)}
            />
            {pinError ? <span className="pin-error">{pinError}</span> : null}
            <button type="submit">{pinReady ? 'Unlock' : 'Save PIN'}</button>
            {pinReady && (
              <button 
                type="button" 
                onClick={async () => {
                  const input = window.prompt("Enter your PIN to confirm you want to wipe this app locally:");
                  if (!input) return;
                  
                  const isValid = await verifyPin(input);
                  if (!isValid) {
                    alert("Incorrect PIN. Reset aborted.");
                    return;
                  }
                  
                  if (window.confirm("PIN verified. Are you absolutely sure you want to delete all local messages and reset the app?")) {
                    localStorage.clear();
                    indexedDB.deleteDatabase('reflection-journal');
                    window.location.reload();
                  }
                }}
                style={{ marginTop: '16px', background: 'transparent', color: '#d32f2f', border: '1px solid #d32f2f' }}
              >
                Reset App & Delete Data
              </button>
            )}
          </form>
        </section>
      ) : null}
    </main>
  )
}

export default App
