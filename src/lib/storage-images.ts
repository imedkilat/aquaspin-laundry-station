import { supabase } from './supabase'

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

export async function compressImageBeforeUpload(file: File, maxDimension = 1600, quality = 0.82): Promise<File> {
  try {
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
