import { useEffect, useRef, useState } from 'react'
import { MAX_RECEIPTS_PER_EXPENSE } from '../lib/limits'
import { useOnline } from '../hooks/useOnline'
import { imageUrl } from '../lib/image'
import { ReceiptImage } from './ReceiptImage'
import { Lightbox } from './Lightbox'

export interface ReceiptState {
  /** Existing storage paths the user hasn't removed. */
  keptPaths: string[]
  /** Newly picked files, uploaded on save. */
  stagedFiles: File[]
}

/**
 * Receipt photos on the expense form: thumbs for kept + staged, remove
 * buttons, and two add controls — "Take photo" (capture=environment, which
 * suppresses the gallery on phones) and "Add photo" (gallery/file picker).
 * Two separate hidden inputs because one input can't offer both cleanly.
 *
 * Offline, the pickers disable — uploads have no offline queue, and the
 * note says photos can be added later by editing.
 */
export function ReceiptSection({
  value,
  onChange,
}: {
  value: ReceiptState
  onChange: (next: ReceiptState) => void
}) {
  const online = useOnline()
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null)

  const total = value.keptPaths.length + value.stagedFiles.length
  const room = MAX_RECEIPTS_PER_EXPENSE - total

  function addFiles(list: FileList | null) {
    if (!list) return
    const incoming = [...list].filter((f) => f.type.startsWith('image/')).slice(0, room)
    if (incoming.length === 0) return
    onChange({ ...value, stagedFiles: [...value.stagedFiles, ...incoming] })
  }

  return (
    <div>
      <span className="block text-sm font-medium text-text-secondary mb-1">
        Receipts <span className="font-normal text-text-muted">(optional, up to {MAX_RECEIPTS_PER_EXPENSE})</span>
      </span>

      {total > 0 && (
        <div className="flex gap-2 mb-2">
          {value.keptPaths.map((p) => (
            <Thumb
              key={p}
              onRemove={() =>
                onChange({ ...value, keptPaths: value.keptPaths.filter((k) => k !== p) })
              }
            >
              <ReceiptImage
                path={p}
                alt="Receipt"
                className="h-20 w-20 rounded-lg border border-line"
                onClick={() =>
                  imageUrl(p)
                    .then((src) => setPreview({ src, alt: 'Receipt' }))
                    .catch(() => {})
                }
              />
            </Thumb>
          ))}
          {value.stagedFiles.map((f, i) => (
            <StagedThumb
              key={`${f.name}-${f.lastModified}-${i}`}
              file={f}
              onPreview={(src) => setPreview({ src, alt: 'New receipt' })}
              onRemove={() =>
                onChange({ ...value, stagedFiles: value.stagedFiles.filter((s) => s !== f) })
              }
            />
          ))}
        </div>
      )}

      {room > 0 && (
        <div className="flex gap-2">
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            disabled={!online}
            onClick={() => cameraRef.current?.click()}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-text-secondary hover:bg-card-hover disabled:opacity-50 transition-colors"
          >
            📷 Take photo
          </button>
          <button
            type="button"
            disabled={!online}
            onClick={() => galleryRef.current?.click()}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-text-secondary hover:bg-card-hover disabled:opacity-50 transition-colors"
          >
            🖼️ Add photo
          </button>
        </div>
      )}
      {!online && (
        <p className="mt-1 text-xs text-text-muted">
          Photos need a connection — you can add them later by editing this expense.
        </p>
      )}

      {preview && <Lightbox src={preview.src} alt={preview.alt} onClose={() => setPreview(null)} />}
    </div>
  )
}

/** Shared remove-button chrome for a thumbnail. */
function Thumb({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="relative">
      {children}
      <button
        type="button"
        aria-label="Remove"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-card border border-line text-xs text-text-secondary shadow hover:text-danger-text"
      >
        ✕
      </button>
    </div>
  )
}

/**
 * A staged (not yet uploaded) file's thumbnail. The object URL's lifecycle
 * IS the component's lifecycle — created on mount, revoked on unmount — so
 * removing the file from the list revokes its URL with no ref bookkeeping.
 */
function StagedThumb({
  file,
  onPreview,
  onRemove,
}: {
  file: File
  onPreview: (src: string) => void
  onRemove: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  return (
    <Thumb onRemove={onRemove}>
      <button
        type="button"
        className="block h-20 w-20 overflow-hidden rounded-lg border border-line bg-muted"
        onClick={() => url && onPreview(url)}
      >
        {url && <img src={url} alt="New receipt" className="h-full w-full object-cover" />}
      </button>
    </Thumb>
  )
}
