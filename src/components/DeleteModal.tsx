export function DeleteModal({
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Yes, delete',
}: {
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
      />
      {/* Modal */}
      <div className="relative bg-card rounded-xl shadow-xl max-w-sm w-full p-6 animate-slide-up">
        <h3 className="text-lg font-semibold text-text mb-2">{title}</h3>
        <p className="text-sm text-text-secondary mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-text-secondary border border-line rounded-lg hover:bg-card-hover transition-colors"
          >
            No
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-danger-text rounded-lg hover:bg-danger-text/90 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
