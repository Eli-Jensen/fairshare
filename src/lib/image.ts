/**
 * Storage-backed images: receipt photos on expenses (and, later, comment
 * photos). Every `firebase/storage` import in the app lives here, so the
 * SDK has one choke point.
 *
 * Paths, never URLs, are what get stored on docs — download URLs embed a
 * token that rotates if an object is overwritten. Random filenames mean we
 * never overwrite, but the invariant costs nothing to keep.
 *
 * Uploads have NO offline queue (unlike Firestore writes) — callers treat
 * them as fallible network ops: Promise.allSettled on save, disabled
 * pickers when offline.
 */
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  listAll,
  deleteObject,
} from 'firebase/storage'
import { storage } from './firebase'
import { MAX_RECEIPT_BYTES } from './limits'

/**
 * Downscale an image File to a JPEG Blob no larger than `maxDim` on its
 * long edge. 1600px, not the sibling app's 1024: receipts are documents —
 * 6-8pt thermal print has to survive a zoom in the Lightbox, and a tall
 * register tape loses its line items at 1024. Typical result lands at
 * 300-800KB, comfortably under the 2MB rules cap.
 *
 * Falls back to the original file if the browser can't decode it (rare
 * HEIC cases) — the size guard in uploadReceipt catches the fallout.
 */
export async function resizeToBlob(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  try {
    const dataUrl = await readAsDataUrl(file)
    const img = await loadImage(dataUrl)
    let { width, height } = img
    if (width >= height && width > maxDim) {
      height = Math.round((height * maxDim) / width)
      width = maxDim
    } else if (height > maxDim) {
      width = Math.round((width * maxDim) / height)
      height = maxDim
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
    )
    return blob ?? file
  } catch {
    return file
  }
}

/** Crypto-random 12-char id (invite.ts style) — unique filenames mean an
 *  object is never overwritten, so its download token never rotates. */
function randomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => chars[b % chars.length]).join('')
}

/** Resize + upload one receipt photo. Returns the storage path. THROWS on
 *  failure (offline, oversized after fallback) — callers allSettled. */
export async function uploadReceipt(tripId: string, expenseId: string, file: File): Promise<string> {
  const blob = await resizeToBlob(file)
  if (blob.size >= MAX_RECEIPT_BYTES) {
    // Only reachable via the undecodable-file pass-through; the rules would
    // deny it anyway, this error is just friendlier than a rules denial.
    throw new Error('That photo is too large even after compression (2MB limit).')
  }
  const path = `trips/${tripId}/receipts/${expenseId}/${randomId()}.jpg`
  await uploadBytes(storageRef(storage, path), blob, { contentType: 'image/jpeg' })
  return path
}

// Lists and detail pages render the same thumbnails — dedupe the
// getDownloadURL round trips. Kept even though paths are immutable here:
// the cache is per-session and failures aren't cached.
const urlCache = new Map<string, Promise<string>>()

/** Resolve a Storage path to a display URL (cached per path). */
export function imageUrl(path: string): Promise<string> {
  let p = urlCache.get(path)
  if (!p) {
    p = getDownloadURL(storageRef(storage, path)).catch((err) => {
      urlCache.delete(path) // don't cache failures
      throw err
    })
    urlCache.set(path, p)
  }
  return p
}

export function invalidateImageUrl(path: string): void {
  urlCache.delete(path)
}

/** Fire-and-forget exact-path deletes. Tolerates undefined/garbage input —
 *  purge paths hand this whatever was on the doc. */
export function deleteReceiptObjects(paths: unknown): void {
  if (!Array.isArray(paths)) return
  for (const p of paths) {
    if (typeof p !== 'string' || !p) continue
    deleteObject(storageRef(storage, p)).catch(() => {})
    urlCache.delete(p)
  }
}

/** Recursively delete every stored object under a Storage folder. */
async function deleteFolder(path: string): Promise<void> {
  const folder = storageRef(storage, path)
  const { items, prefixes } = await listAll(folder)
  await Promise.all(items.map((i) => deleteObject(i).catch(() => {})))
  await Promise.all(prefixes.map((p) => deleteFolder(p.fullPath)))
}

/**
 * Sweep a trip's storage before its docs are purged — best-effort AND
 * time-boxed.
 *
 * Order matters more than completeness: storage.rules authorizes via
 * firestore.get on the TRIP DOC, and purgeTrip deletes that doc last for
 * the same reason — so this sweep must run FIRST, while it still can.
 * Objects missed here are permanently undeletable by any client (console
 * only), which is also why the exact `knownPaths` are deleted alongside the
 * folder walk: two chances.
 *
 * The 5s race keeps an unreachable bucket from stalling the purge chain
 * (the SDK retries listAll for ~2min against a dead host); leftovers are
 * harmless free-tier crumbs, a blocked purge is not.
 */
export async function purgeTripReceipts(tripId: string, knownPaths: string[]): Promise<void> {
  deleteReceiptObjects(knownPaths)
  await Promise.race([
    deleteFolder(`trips/${tripId}`).catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ])
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = src
  })
}
