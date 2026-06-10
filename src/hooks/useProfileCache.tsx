import {
  createContext,
  useContext,
  useRef,
  useCallback,
  type ReactNode,
} from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { UserProfile } from '../lib/types'

interface ProfileCacheState {
  getProfiles: (uids: string[]) => Promise<Record<string, UserProfile>>
  invalidateProfile: (uid: string) => void
}

const ProfileCacheContext = createContext<ProfileCacheState>({
  getProfiles: async () => ({}),
  invalidateProfile: () => {},
})

export function ProfileCacheProvider({ children }: { children: ReactNode }) {
  const cache = useRef<Record<string, UserProfile>>({})
  const pending = useRef<Record<string, Promise<UserProfile | null>>>({})

  const getProfiles = useCallback(async (uids: string[]): Promise<Record<string, UserProfile>> => {
    const result: Record<string, UserProfile> = {}
    const toFetch: string[] = []

    // Return cached, collect missing
    for (const uid of uids) {
      if (cache.current[uid]) {
        result[uid] = cache.current[uid]
      } else if (!pending.current[uid]) {
        toFetch.push(uid)
      }
    }

    // Fetch missing in parallel (deduplicated)
    if (toFetch.length > 0) {
      const promises = toFetch.map((uid) => {
        const p = getDoc(doc(db, 'users', uid)).then((snap) => {
          if (snap.exists()) {
            const profile = snap.data() as UserProfile
            cache.current[uid] = profile
            return profile
          }
          return null
        }).finally(() => {
          delete pending.current[uid]
        })
        pending.current[uid] = p
        return p
      })

      await Promise.all(promises)

      // Collect fetched results
      for (const uid of toFetch) {
        if (cache.current[uid]) {
          result[uid] = cache.current[uid]
        }
      }
    }

    // Wait for any in-flight requests from other callers
    const stillPending = uids.filter((uid) => !result[uid] && pending.current[uid])
    if (stillPending.length > 0) {
      await Promise.all(stillPending.map((uid) => pending.current[uid]))
      for (const uid of stillPending) {
        if (cache.current[uid]) {
          result[uid] = cache.current[uid]
        }
      }
    }

    return result
  }, [])

  // Drop a cached profile after the user edits it so the new name/photo
  // shows up without a full reload
  const invalidateProfile = useCallback((uid: string) => {
    delete cache.current[uid]
  }, [])

  return (
    <ProfileCacheContext.Provider value={{ getProfiles, invalidateProfile }}>
      {children}
    </ProfileCacheContext.Provider>
  )
}

export function useProfileCache() {
  return useContext(ProfileCacheContext)
}
