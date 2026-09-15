const SHOP_TIME_ZONE = 'Asia/Manila'

export function shopDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  if (!year || !month || !day) throw new Error('Unable to resolve shop date')
  return `${year}-${month}-${day}`
}

export function shopDateDaysAgo(days: number) {
  return shopDate(new Date(Date.now() - days * 86_400_000))
}
