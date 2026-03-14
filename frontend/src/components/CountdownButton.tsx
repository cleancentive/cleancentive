import { useCallback, useEffect, useRef, useState } from 'react'

interface CountdownButtonProps {
  intervalSeconds: number
  isLoading: boolean
  disabled?: boolean
  onRefresh: () => void
  label?: string
  loadingLabel?: string
  className?: string
}

export function CountdownButton({
  intervalSeconds,
  isLoading,
  disabled = false,
  onRefresh,
  label = 'Refresh',
  loadingLabel = 'Refreshing...',
  className,
}: CountdownButtonProps) {
  const [countdown, setCountdown] = useState(intervalSeconds)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  const resetCountdown = useCallback((seconds: number) => {
    const btn = btnRef.current
    if (btn) {
      btn.classList.add('countdown-button-no-transition')
    }
    setCountdown(seconds)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (btn) {
          btn.classList.remove('countdown-button-no-transition')
        }
      })
    })
  }, [])

  // Reset when interval changes
  useEffect(() => {
    resetCountdown(intervalSeconds)
  }, [intervalSeconds, resetCountdown])

  useEffect(() => {
    const tick = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (document.visibilityState === 'visible') {
            onRefreshRef.current()
          }
          resetCountdown(intervalSeconds)
          return intervalSeconds
        }
        return prev - 1
      })
    }, 1000)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        onRefreshRef.current()
        resetCountdown(intervalSeconds)
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalSeconds, resetCountdown])

  const handleClick = () => {
    onRefresh()
    resetCountdown(intervalSeconds)
  }

  const progress = isLoading ? 0 : (intervalSeconds - countdown) / intervalSeconds

  return (
    <button
      ref={btnRef}
      type="button"
      className={`countdown-button${className ? ` ${className}` : ''}`}
      style={{ '--refresh-progress': progress } as React.CSSProperties}
      onClick={handleClick}
      disabled={disabled || isLoading}
    >
      {isLoading ? loadingLabel : label}
    </button>
  )
}
