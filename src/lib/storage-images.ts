import { supabase } from './supabase.ts'

export const SHOP_BRANDING_BUCKET = 'shop-branding'
export const PROFILE_AVATARS_BUCKET = 'profile-avatars'
export const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function validateProfileImage(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return 'Use a PNG, JPG/JPEG, or WebP image.'
  }
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    return 'Image must be 2 MB or smaller.'
  }
  return null
}

export function imageExtension(file: File) {
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  return 'jpg'
}

// Animated PNG (APNG) and animated WebP both decode to a single still frame
// via createImageBitmap/canvas, so running them through the resize step below
// would silently discard every frame but one. Detect them up front by
// walking the container's chunks and skip compression entirely for an
// animated input — it uploads as-is instead of losing its animation.
export function isAnimatedPng(bytes: Uint8Array): boolean {
  // PNG: 8-byte signature, then [4-byte length][4-byte type][data][4-byte CRC]
  // chunks. A valid APNG's 'acTL' chunk always precedes the first 'IDAT'.
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length =
      ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    if (type === 'acTL') return true
    if (type === 'IDAT') return false
    offset += 8 + length + 4
  }
  return false
}

export function isAnimatedWebp(bytes: Uint8Array): boolean {
  // WebP: 'RIFF'(4) + size(4) + 'WEBP'(4), then [4-byte fourCC][4-byte size]
  // chunks (data padded to an even length). An animated WebP carries an
  // 'ANIM' chunk.
  if (bytes.length < 12) return false
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const fourCC = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
    if (fourCC === 'ANIM') return true
    const size = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24)
    offset += 8 + size + (size % 2)
  }
  return false
}

export async function isAnimatedImage(file: File): Promise<boolean> {
  if (file.type !== 'image/png' && file.type !== 'image/webp') return false
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    return file.type === 'image/png' ? isAnimatedPng(bytes) : isAnimatedWebp(bytes)
  } catch {
    // Can't confirm it's a static image — skip compression rather than risk
    // silently flattening an animation.
    return true
  }
}

export async function compressImageBeforeUpload(file: File, maxDimension = 1600, quality = 0.82): Promise<File> {
  try {
    if (await isAnimatedImage(file)) return file
    const image = await createImageBitmap(file)
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(image, 0, 0, width, height)
    image.close()

    const blob = await new Promise<Blob | null>((resolve) => {
      if (file.type === 'image/png') canvas.toBlob(resolve, file.type)
      else canvas.toBlob(resolve, file.type, quality)
    })
    if (!blob || blob.type !== file.type || blob.size >= file.size) return file
    return new File([blob], file.name, { type: file.type, lastModified: file.lastModified })
  } catch {
    return file
  }
}

export function getShopLogoUrl(path: string | null | undefined) {
  if (!path) return null
  return supabase.storage.from(SHOP_BRANDING_BUCKET).getPublicUrl(path).data.publicUrl
}

export async function createAvatarSignedUrl(path: string | null | undefined) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(PROFILE_AVATARS_BUCKET).createSignedUrl(path, 60 * 60)
  if (error) return null
  return data.signedUrl
}
