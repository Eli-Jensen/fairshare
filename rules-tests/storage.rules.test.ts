/**
 * Storage security-rules tests — the photo boundary. Run via
 * `npm run test:rules` (both the firestore AND storage emulators are up;
 * singleProjectMode lets storage.rules' firestore.get() see the seeded trip
 * docs).
 *
 * What these lock in: membership (via the trip doc) gates every object op,
 * the 2MB / image-only caps hold, and the list-only sweep block lets a
 * member walk trips/{id}/… prefixes without granting anything else.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getBytes, deleteObject, listAll } from 'firebase/storage'

// MUST match the --project id emulators:exec runs under: the storage
// emulator resolves storage.rules' cross-service firestore.get() against the
// HUB's project, not this environment's — a different id here seeds a
// namespace those lookups never read, and every membership check goes null.
// (Sharing the id with the firestore suite is what makes fileParallelism:
// false in vitest.rules.config.ts load-bearing: concurrent files would
// clearFirestore() each other's seeds.)
const PROJECT = 'demo-fairshare'
const ALICE = 'alice-uid'
const CAROL = 'carol-uid' // member of trip2 only — "member of ANOTHER trip"

const TRIP = 'trip1'
const RECEIPT = `trips/${TRIP}/receipts/exp1/r1.jpg`
const COMMENT_PHOTO = `trips/${TRIP}/comments/c1.jpg`

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const TWO_MB = new Uint8Array(2 * 1024 * 1024) // exactly the cap — rule is `<`

let env: RulesTestEnvironment

const storageAs = (uid: string) => env.authenticatedContext(uid).storage()

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  })
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearStorage()
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, `trips/${TRIP}`), { name: 'Tokyo', memberUids: [ALICE, 'bob-uid'] })
    await setDoc(doc(db, 'trips/trip2'), { name: 'Lisbon', memberUids: [CAROL] })
  })
})

async function seedObject(path: string): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), path), JPEG, { contentType: 'image/jpeg' })
  })
}

describe('receipt objects', () => {
  it('member uploads an image', async () => {
    await assertSucceeds(
      uploadBytes(ref(storageAs(ALICE), RECEIPT), JPEG, { contentType: 'image/jpeg' })
    )
  })

  it('a member of a DIFFERENT trip is a stranger here', async () => {
    await assertFails(
      uploadBytes(ref(storageAs(CAROL), RECEIPT), JPEG, { contentType: 'image/jpeg' })
    )
  })

  it('unauthenticated upload is denied', async () => {
    await assertFails(
      uploadBytes(ref(env.unauthenticatedContext().storage(), RECEIPT), JPEG, {
        contentType: 'image/jpeg',
      })
    )
  })

  it('exactly 2MB is over the line (rule is strict <)', async () => {
    await assertFails(
      uploadBytes(ref(storageAs(ALICE), RECEIPT), TWO_MB, { contentType: 'image/jpeg' })
    )
  })

  it('non-image content type is denied', async () => {
    await assertFails(
      uploadBytes(ref(storageAs(ALICE), RECEIPT), JPEG, { contentType: 'application/pdf' })
    )
  })

  it('member reads and deletes; non-member neither', async () => {
    await seedObject(RECEIPT)
    await assertSucceeds(getBytes(ref(storageAs(ALICE), RECEIPT)))
    await assertFails(getBytes(ref(storageAs(CAROL), RECEIPT)))
    await assertFails(deleteObject(ref(storageAs(CAROL), RECEIPT)))
    await assertSucceeds(deleteObject(ref(storageAs(ALICE), RECEIPT)))
  })
})

describe('comment photos', () => {
  it('same member contract as receipts', async () => {
    await assertSucceeds(
      uploadBytes(ref(storageAs(ALICE), COMMENT_PHOTO), JPEG, { contentType: 'image/jpeg' })
    )
    await assertFails(
      uploadBytes(ref(storageAs(CAROL), COMMENT_PHOTO), JPEG, { contentType: 'image/jpeg' })
    )
  })
})

describe('the purge sweep list block', () => {
  it('member can list the receipts folder; non-member cannot', async () => {
    await seedObject(RECEIPT)
    // This is what keeps purgeTrip's deleteFolder from being a silent no-op.
    await assertSucceeds(listAll(ref(storageAs(ALICE), `trips/${TRIP}/receipts`)))
    await assertFails(listAll(ref(storageAs(CAROL), `trips/${TRIP}/receipts`)))
  })

  it('list grants nothing outside trips/', async () => {
    await assertFails(listAll(ref(storageAs(ALICE), 'somewhere-else')))
  })
})
