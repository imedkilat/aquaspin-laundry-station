export function toTitleCaseName(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-PH')
    .replace(/(^|[\s'-])\p{L}/gu, (match) => match.toLocaleUpperCase('en-PH'))
}
