import { lazy, Suspense } from 'react'
import type { Theme as EmojiTheme } from 'emoji-picker-react'

// Lazy so the (sizeable) emoji data only loads when the grid is opened.
const EmojiPicker = lazy(() => import('emoji-picker-react'))

/**
 * Themed emoji picker grid (pattern from Fairshare's ExpenseForm). Render it
 * full-width below the trigger; calls onPick with the chosen emoji.
 */
export function EmojiGrid({ onPick }: { onPick: (emoji: string) => void }) {
  const isDark = document.documentElement.classList.contains('dark')
  return (
    <div className="mt-1 overflow-hidden rounded-lg [&_.epr-main]:!border-line [&_.epr-search-container_input]:!border-line [&_.epr-search-container_input]:!bg-input">
      <Suspense
        fallback={
          <div className="flex h-[350px] items-center justify-center text-sm text-text-muted">
            Loading…
          </div>
        }
      >
        <EmojiPicker
          onEmojiClick={(emojiData) => onPick(emojiData.emoji)}
          width="100%"
          height={350}
          theme={(isDark ? 'dark' : 'light') as EmojiTheme}
          searchPlaceholder="Search emojis..."
          previewConfig={{ showPreview: false }}
          skinTonesDisabled
          lazyLoadEmojis
        />
      </Suspense>
    </div>
  )
}
