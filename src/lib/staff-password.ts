// Staff password rules. The Edge Functions (create-staff-user and
// manage-staff-user) enforce the same limits server-side; this copy only gives
// the Owner an immediate, readable message before the request is sent.
export const STAFF_PASSWORD_MIN_LENGTH = 8
// bcrypt (Supabase Auth) only uses the first 72 bytes and recent Auth versions
// reject longer passwords. Bytes, not characters: "€" is 3 bytes.
export const STAFF_PASSWORD_MAX_BYTES = 72

export function staffPasswordProblem(password: string): string | null {
  if (password.length < STAFF_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${STAFF_PASSWORD_MIN_LENGTH} characters.`
  }
  if (new TextEncoder().encode(password).length > STAFF_PASSWORD_MAX_BYTES) {
    return `Password must be ${STAFF_PASSWORD_MAX_BYTES} bytes or fewer (about ${STAFF_PASSWORD_MAX_BYTES} characters).`
  }
  return null
}
