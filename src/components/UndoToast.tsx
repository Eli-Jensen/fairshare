import { useEffect, useState } from 'react'

const TOAST_DURATION = 10_000

export function UndoToast({
  message,
  onUndo,
  onDismiss,
}: {
  message: string
  onUndo: () => void
  onDismiss: () => void
}) {
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - start
      const remaining = Math.max(0, 100 - (elapsed / TOAST_DURATION) * 100)
      setProgress(remaining)
      if (remaining <= 0) {
        clearInterval(interval)
        onDismiss()
      }
    }, 50)

    return () => clearInterval(interval)
  }, [onDismiss])

  return (
    <div className="fixed bottom-20 sm:bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-50 animate-slide-up">
      <div className="bg-slate-800 text-white rounded-lg shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm">{message}</p>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            <button
              onClick={onUndo}
              className="text-sm font-semibold text-primary-300 hover:text-primary-200 transition-colors"
            >
              Undo
            </button>
            <button
              onClick={onDismiss}
              className="text-text-muted hover:text-slate-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="h-0.5 bg-slate-700">
          <div
            className="h-full bg-primary-400 transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}
