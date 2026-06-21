import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface CountdownButtonProps {
  intervalSeconds: number
  isLoading: boolean
  disabled?: boolean
  onRefresh: () => void
  label?: string
  loadingLabel?: string
  disabledLabel?: string
  className?: string
}

export function CountdownButton({
  intervalSeconds,
  isLoading,
  disabled = false,
  onRefresh,
  label,
  loadingLabel,
  disabledLabel,
  className,
}: CountdownButtonProps) {
  const { t } = useTranslation(['spot', 'common'])
  const resolvedLabel = label ?? t('countdown.refresh')
  const resolvedLoadingLabel = loadingLabel ?? t('countdown.refreshing')
  const resolvedDisabledLabel = disabledLabel ?? t('countdown.offline')
  const [countdown, setCountdown] = useState(intervalSeconds)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh
  const wasDisabledRef = useRef(disabled)

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

  // When re-enabled (e.g. back online), immediately refresh
  useEffect(() => {
    if (wasDisabledRef.current && !disabled) {
      onRefreshRef.current()
      resetCountdown(intervalSeconds)
    }
    wasDisabledRef.current = disabled
  }, [disabled, intervalSeconds, resetCountdown])

  useEffect(() => {
    if (disabled) return

    const tick = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (document.visibilityState === 'visible') {
            setTimeout(() => onRefreshRef.current(), 0)
          }
          resetCountdown(intervalSeconds)
          return intervalSeconds
        }
        return prev - 1
      })
    }, 1000)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setTimeout(() => onRefreshRef.current(), 0)
        resetCountdown(intervalSeconds)
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalSeconds, resetCountdown, disabled])

  const handleClick = () => {
    onRefresh()
    resetCountdown(intervalSeconds)
  }

  const progress = (disabled || isLoading) ? 0 : (intervalSeconds - countdown) / intervalSeconds

  let buttonLabel = resolvedLabel
  if (disabled) buttonLabel = resolvedDisabledLabel
  else if (isLoading) buttonLabel = resolvedLoadingLabel

  return (
    <button
      ref={btnRef}
      type="button"
      className={`countdown-button${className ? ` ${className}` : ''}`}
      style={{ '--refresh-progress': progress } as React.CSSProperties}
      onClick={handleClick}
      disabled={disabled || isLoading}
    >
      {buttonLabel}
    </button>
  )
}
