import assert from 'node:assert/strict'
import test from 'node:test'
import { STAFF_PASSWORD_MAX_BYTES, STAFF_PASSWORD_MIN_LENGTH, staffPasswordProblem } from '../src/lib/staff-password.ts'

// Client-side mirror of the Edge Function rules (enforced server-side in
// supabase/functions/*; see tests/backend/edge-manage-staff-user.mjs).
test('staff password limits match the server (8 characters minimum, 72 bytes maximum)', () => {
  assert.equal(STAFF_PASSWORD_MIN_LENGTH, 8)
  assert.equal(STAFF_PASSWORD_MAX_BYTES, 72)
})

test('rejects passwords that are too short', () => {
  assert.match(staffPasswordProblem(''), /at least 8/)
  assert.match(staffPasswordProblem('1234567'), /at least 8/)
})

test('accepts 8 characters up to 72 bytes', () => {
  assert.equal(staffPasswordProblem('12345678'), null)
  assert.equal(staffPasswordProblem('x'.repeat(72)), null)
  assert.equal(staffPasswordProblem('€'.repeat(24)), null)
})

test('rejects passwords over 72 bytes, counting multibyte characters', () => {
  assert.match(staffPasswordProblem('x'.repeat(73)), /72 bytes/)
  assert.match(staffPasswordProblem('€'.repeat(25)), /72 bytes/)
  assert.match(staffPasswordProblem('x'.repeat(5000)), /72 bytes/)
})

test('the browser, the edit modal and both Edge Functions share one policy', async () => {
  const { readFile } = await import('node:fs/promises')
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  const [manager, modal, manage, create] = await Promise.all([
    read('src/components/StaffAccountsManager.tsx'),
    read('src/components/EditStaffAccountModal.tsx'),
    read('supabase/functions/manage-staff-user/index.ts'),
    read('supabase/functions/create-staff-user/index.ts'),
  ])
  for (const source of [manager, modal]) assert.match(source, /staffPasswordProblem/)
  for (const source of [manage, create]) {
    assert.match(source, /PASSWORD_MIN_LENGTH = 8/)
    assert.match(source, /PASSWORD_MAX_BYTES = 72/)
  }
})
