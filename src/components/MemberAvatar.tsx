import { useState, useRef, useEffect } from 'react'
import type { UserProfile } from '../lib/types'

export function MemberAvatar({
  member,
  size = 'md',
  showInfoOnClick = false,
}: {
  member: UserProfile | undefined
  size?: 'sm' | 'md' | 'lg'
  showInfoOnClick?: boolean
}) {
  const [showInfo, setShowInfo] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const px = size === 'sm' ? 'w-6 h-6' : size === 'lg' ? 'w-12 h-12' : 'w-8 h-8'
  const text = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-lg' : 'text-sm'

  useEffect(() => {
    if (!showInfo) return
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowInfo(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showInfo])

  function handleClick(e: React.MouseEvent) {
    if (!showInfoOnClick || !member) return
    e.stopPropagation()
    e.preventDefault()
    setShowInfo(!showInfo)
  }

  const googleName = member?.googleDisplayName ?? member?.displayName
  const googlePhoto = member?.googlePhotoURL ?? member?.photoURL
  const hasCustomName = member && member.displayName !== googleName
  const hasCustomPhoto = member && member.photoURL !== googlePhoto

  const avatar = renderAvatar()

  if (!showInfoOnClick || !member) return avatar

  return (
    <div className="relative" ref={popoverRef}>
      <button type="button" onClick={handleClick} className="block">
        {avatar}
      </button>
      {showInfo && (
        <>
        <button
          type="button"
          aria-label="Close"
          className="fixed inset-0 z-40 cursor-default"
          onClick={(e) => { e.stopPropagation(); setShowInfo(false); }}
        />
        <div className="absolute right-0 sm:left-0 sm:right-auto top-full mt-1 bg-card border border-line rounded-lg shadow-lg p-3 z-50 w-56 max-w-[calc(100vw-2rem)] animate-slide-up">
          <div className="flex items-center gap-2 mb-2">
            {googlePhoto && (
              <img
                src={googlePhoto}
                alt=""
                className="w-8 h-8 rounded-full shrink-0"
                referrerPolicy="no-referrer"
              />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-text truncate">
                {googleName}
              </p>
              {member.email && (
                <p className="text-xs text-text-muted truncate">{member.email}</p>
              )}
            </div>
          </div>
          {(hasCustomName || hasCustomPhoto) && (
            <p className="text-xs text-text-muted border-t border-line-light pt-2">
              Goes by <span className="font-medium text-text-secondary">{member.displayName}</span>
            </p>
          )}
        </div>
        </>
      )}
    </div>
  )

  function renderAvatar() {
    if (!member) {
      return (
        <div
          className={`${px} rounded-full bg-muted flex items-center justify-center ${text} text-text-secondary`}
        >
          ?
        </div>
      )
    }

    if (member.photoURL) {
      return (
        <img
          src={member.photoURL}
          alt={member.displayName}
          className={`${px} rounded-full`}
          referrerPolicy="no-referrer"
          title={member.displayName}
        />
      )
    }

    const initial = member.displayName?.charAt(0)?.toUpperCase() || '?'
    return (
      <div
        className={`${px} rounded-full flex items-center justify-center ${text} font-medium ${
          member.isPlaceholder
            ? 'bg-muted border border-dashed border-line text-text-muted'
            : 'bg-primary-100 text-accent-text'
        }`}
        title={member.isPlaceholder ? `${member.displayName} (invited)` : member.displayName}
      >
        {initial}
      </div>
    )
  }
}
