import { useEffect, useRef, useState } from 'react'
import { Play, Pause } from 'lucide-react'

export function AudioPlayer({ src }) {
  const audioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    if (audio.readyState >= 1) {
      setDuration(audio.duration)
    }

    const handleLoadedMetadata = () => {
      setDuration(audio.duration)
    }
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
    } else {
      audio.play()
    }
    setIsPlaying(!isPlaying)
  }

  const formatTime = (time) => {
    if (!time || isNaN(time)) return '0:00'
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const handleSeek = (e) => {
    const audio = audioRef.current
    if (!audio) return
    const newTime = (e.target.value / 100) * duration
    audio.currentTime = newTime
    setCurrentTime(newTime)
  }

  const progressPercentage = duration ? (currentTime / duration) * 100 : 0

  return (
    <div className="audio-player">
      <button className="audio-play-button" onClick={togglePlay} type="button" aria-label={isPlaying ? "Pause" : "Play"}>
        {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>

      <div className="audio-timeline-container min-w-50">
        <div className="audio-timeline">
          <div className="audio-timeline-progress" style={{ width: `${progressPercentage}%` }}>
            <div className="audio-timeline-thumb"></div>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={progressPercentage}
            onChange={handleSeek}
            className="audio-timeline-input"
            aria-label="Seek audio"
          />
        </div>
        <div className="audio-time">{formatTime(isPlaying ? currentTime : duration)}</div>
      </div>

      <div className="audio-avatar">
        S
      </div>

      <audio ref={audioRef} src={src} preload="metadata" className="sr-only" />
    </div>
  )
}
