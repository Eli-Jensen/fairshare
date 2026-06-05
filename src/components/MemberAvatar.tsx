import type { UserProfile } from '../lib/types'

export function MemberAvatar({
  member,
  size = 'md',
}: {
  member: UserProfile | undefined
  size?: 'sm' | 'md' | 'lg'
}) {
  const px = size === 'sm' ? 'w-6 h-6' : size === 'lg' ? 'w-12 h-12' : 'w-8 h-8'
  const text = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-lg' : 'text-sm'

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
