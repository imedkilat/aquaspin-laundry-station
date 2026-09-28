type ListQueryResult<T> = {
  data: T[] | null
  error: unknown
}

export type PrintDetailsState<TCustomerItem, TServiceItem> = {
  customerItems: TCustomerItem[] | null
  serviceItems: TServiceItem[] | null
  customerItemsError: string | null
  serviceItemsError: string | null
}

type PrintDetailsInput<TCustomerItem, TServiceItem> = {
  customerItems: TCustomerItem[] | null | undefined
  serviceItems: TServiceItem[] | null | undefined
  customerItemsError: string | null
  serviceItemsError: string | null
}

export function resolvePrintDetails<TCustomerItem, TServiceItem>(
  customerResult: ListQueryResult<TCustomerItem>,
  serviceResult: ListQueryResult<TServiceItem>,
): PrintDetailsState<TCustomerItem, TServiceItem> {
  return {
    customerItems: customerResult.error ? null : customerResult.data ?? [],
    serviceItems: serviceResult.error ? null : serviceResult.data ?? [],
    customerItemsError: customerResult.error
      ? 'The order opened, but customer clothing items could not be loaded. Refresh and try again.'
      : null,
    serviceItemsError: serviceResult.error
      ? 'The order opened, but additional service lines could not be loaded. Refresh and try again.'
      : null,
  }
}

export function getPrintDetailsError<TCustomerItem, TServiceItem>(
  state: PrintDetailsInput<TCustomerItem, TServiceItem>,
): string | null {
  return state.customerItemsError || state.serviceItemsError ||
    (state.customerItems === null ? 'Could not load clothing items for this order. Please try again.' : null) ||
    (state.serviceItems === null ? 'Could not load service lines for this order. Please try again.' : null)
}

export function canPrintDetails<TCustomerItem, TServiceItem>(
  customerItems: TCustomerItem[] | null,
  serviceItems: TServiceItem[] | null,
  detailsError: string | null,
  loading = false,
): boolean {
  return !loading && customerItems !== null && serviceItems !== null && !detailsError
}
