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
        <div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg p-3 z-50 w-56 animate-slide-up">
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
              <p className="text-sm font-medium text-slate-900 truncate">
                {googleName}
              </p>
              <p className="text-xs text-slate-400 truncate">{member.email}</p>
            </div>
          </div>
          {(hasCustomName || hasCustomPhoto) && (
            <p className="text-xs text-slate-400 border-t border-slate-100 pt-2">
              Goes by <span className="font-medium text-slate-600">{member.displayName}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )

  function renderAvatar() {
    if (!member) {
      return (
        <div
          className={`${px} rounded-full bg-slate-200 flex items-center justify-center ${text} text-slate-500`}
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
        className={`${px} rounded-full bg-primary-100 text-primary-700 flex items-center justify-center ${text} font-medium`}
        title={member.displayName}
      >
        {initial}
      </div>
    )
  }
}
