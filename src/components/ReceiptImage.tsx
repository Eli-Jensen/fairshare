import { useImageUrl } from '../hooks/useImageUrl'

/** A Storage-path-backed thumbnail with a skeleton while the URL resolves. */
export function ReceiptImage({
  path,
  alt,
  className = '',
  onClick,
}: {
  path: string
  alt: string
  className?: string
  onClick?: () => void
}) {
  const url = useImageUrl(path)

  if (!url) {
    return <div aria-hidden className={`animate-pulse bg-muted ${className}`} />
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`block overflow-hidden ${className}`}>
        <img src={url} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      </button>
    )
  }
  return (
    <img src={url} alt={alt} loading="lazy" className={`object-cover ${className}`} />
  )
}
