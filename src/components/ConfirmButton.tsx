import { useState, useEffect, useRef } from 'react'

export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className,
  confirmClassName,
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  className: string
  confirmClassName: string
}) {
  const [confirming, setConfirming] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  function handleClick() {
    if (!confirming) {
      setConfirming(true)
      // Auto-reset after 4 seconds if not confirmed
      timeoutRef.current = setTimeout(() => setConfirming(false), 4000)
    } else {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      setConfirming(false)
      onConfirm()
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={confirming ? confirmClassName : className}
    >
      {confirming ? confirmLabel : label}
    </button>
  )
}
