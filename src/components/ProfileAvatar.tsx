import { useEffect, useState } from 'react'
import { createAvatarSignedUrl } from '../lib/storage-images'

export default function ProfileAvatar({
  path,
  name,
  size = 'md',
}: {
  path?: string | null
  name?: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setUrl(null)
    if (!path) return

    void createAvatarSignedUrl(path).then((signedUrl) => {
      if (!cancelled) setUrl(signedUrl)
    })

    return () => {
      cancelled = true
    }
  }, [path])

  const sizeClass = size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-24 w-24 text-2xl' : 'h-10 w-10 text-sm'
  const initials = (name || 'User')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U'

  if (url) {
    return <img src={url} alt={name ? `${name} profile` : 'Profile'} className={`${sizeClass} rounded-full object-cover border border-slate-200 dark:border-slate-700`} />
  }

  return (
    <span className={`${sizeClass} inline-flex shrink-0 items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300`} aria-label={name ? `${name} profile` : 'Profile'}>
      {initials}
    </span>
  )
}
