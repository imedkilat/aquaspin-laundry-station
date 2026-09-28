/** Returns a user-facing validation error for quantities whose unit requires whole counts. */
export function getUnitQuantityValidationError(value: string | number, unit: string, label = 'Quantity') {
  const normalized = String(value).trim()
  if (!normalized) return null

  const quantity = Number(normalized)
  if (!Number.isFinite(quantity)) return `${label} must be a valid number.`
  if (unit === 'pcs' && !Number.isInteger(quantity)) {
    return `${label} for pcs items must be a whole number.`
  }

  return null
}

export function isValidUnitQuantity(value: string | number, unit: string) {
  const normalized = String(value).trim()
  return Boolean(normalized) && Number.isFinite(Number(normalized)) && getUnitQuantityValidationError(normalized, unit) === null
}
