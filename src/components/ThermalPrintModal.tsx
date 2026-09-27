import { useEffect, useState } from 'react'
import type { TransactionWithService, TransactionCustomerItem, TransactionServiceItem } from '../types/database'
import {
  openThermalPrintWindow,
  paymentLabel,
  peso,
  recordedLabel,
  type ThermalPaperWidth,
  type ThermalPrintMode,
} from '../lib/thermal-receipt'
import { generateQrSvg } from '../lib/qr-code'
import { issueOrderTrackingLink } from '../lib/order-tracking'
import { isDropOffTransaction } from '../lib/service-classification'
import { canPrintDetails, getPrintDetailsError } from '../lib/print-details-state'
import { supabase } from '../lib/supabase'
import { useShopSettings } from '../lib/shop-settings-context'
import UiIcon from './UiIcon'
import { ButtonSpinner, InlineAlert } from './UiFeedback'

export default function ThermalPrintModal({
  transaction,
  customerItems: initialCustomerItems,
  serviceItems: initialServiceItems,
  customerItemsError: initialCustomerItemsError,
  serviceItemsError: initialServiceItemsError,
  parentLoading = false,
  onClose,
}: {
  transaction: TransactionWithService
  customerItems?: TransactionCustomerItem[] | null
  serviceItems?: TransactionServiceItem[] | null
  customerItemsError?: string | null
  serviceItemsError?: string | null
  parentLoading?: boolean
  onClose: () => void
}) {
  const { settings } = useShopSettings()
  const [mode, setMode] = useState<ThermalPrintMode>('receipt')
  const [paperWidth, setPaperWidth] = useState<ThermalPaperWidth>('58mm')
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initialDetailsError = getPrintDetailsError({
    customerItems: initialCustomerItems,
    serviceItems: initialServiceItems,
    customerItemsError: initialCustomerItemsError ?? null,
    serviceItemsError: initialServiceItemsError ?? null,
  })

  // Loaded details state
  const [loadedCustomerItems, setLoadedCustomerItems] = useState<TransactionCustomerItem[]>(initialCustomerItems ?? [])
  const [loadedServiceItems, setLoadedServiceItems] = useState<TransactionServiceItem[]>(initialServiceItems ?? [])
  const [loadingDetails, setLoadingDetails] = useState(
    !initialDetailsError && (initialCustomerItems === undefined || initialServiceItems === undefined)
  )
  const [loadedDetailsError, setLoadedDetailsError] = useState<string | null>(initialDetailsError)
  const customerItems = initialCustomerItems !== undefined ? initialCustomerItems ?? [] : loadedCustomerItems
  const serviceItems = initialServiceItems !== undefined ? initialServiceItems ?? [] : loadedServiceItems
  const detailsError = initialCustomerItemsError || initialServiceItemsError || loadedDetailsError
  const isLoadingDetails = parentLoading || loadingDetails
  const [qrSvg, setQrSvg] = useState<string>('')
  const [loadingQr, setLoadingQr] = useState<boolean>(true)
  const [qrError, setQrError] = useState<string | null>(null)

  // Pre-generate secure signed tracking QR SVG
  useEffect(() => {
    let cancelled = false
    setLoadingQr(true)
    setQrError(null)
    setQrSvg('')

    const loadQr = async () => {
      try {
        const trackingUrl = await issueOrderTrackingLink(transaction.id)
        const svg = await generateQrSvg(trackingUrl)
        if (!cancelled) {
          setQrSvg(svg)
          setLoadingQr(false)
        }
      } catch (err) {
        if (!cancelled) {
          setQrSvg('')
          setQrError(err instanceof Error ? err.message : 'Could not generate secure tracking QR.')
          setLoadingQr(false)
        }
      }
    }

    void loadQr()

    return () => {
      cancelled = true
    }
  }, [transaction.id])

  const handleRetryQr = async () => {
    setLoadingQr(true)
    setQrError(null)
    setQrSvg('')
    try {
      const trackingUrl = await issueOrderTrackingLink(transaction.id)
      const svg = await generateQrSvg(trackingUrl)
      setQrSvg(svg)
    } catch (err) {
      setQrSvg('')
      setQrError(err instanceof Error ? err.message : 'Could not generate secure tracking QR.')
    } finally {
      setLoadingQr(false)
    }
  }

  // Fetch missing customerItems or serviceItems from DB if not provided by caller
  useEffect(() => {
    if (parentLoading) {
      return
    }

    if (initialCustomerItemsError || initialServiceItemsError || initialCustomerItems === null || initialServiceItems === null) {
      const err =
        initialCustomerItemsError ||
        initialServiceItemsError ||
        (initialCustomerItems === null ? 'Could not load clothing items for this order. Please try again.' : null) ||
        'Could not load service lines for this order. Please try again.'
      setLoadedDetailsError(err)
      setLoadingDetails(false)
      return
    }

    if (initialCustomerItems !== undefined && initialServiceItems !== undefined) {
      setLoadedCustomerItems(initialCustomerItems)
      setLoadedServiceItems(initialServiceItems)
      setLoadingDetails(false)
      setLoadedDetailsError(null)
      return
    }

    let cancelled = false
    setLoadingDetails(true)
    setLoadedDetailsError(null)

    const fetchDetails = async () => {
      try {
        const promises = [
          initialCustomerItems !== undefined
            ? Promise.resolve({ data: initialCustomerItems, error: null })
            : supabase
                .from('transaction_customer_items')
                .select('*')
                .eq('transaction_id', transaction.id)
                .order('item_type'),
          initialServiceItems !== undefined
            ? Promise.resolve({ data: initialServiceItems, error: null })
            : supabase
                .from('transaction_service_items')
                .select('*')
                .eq('transaction_id', transaction.id)
                .order('position'),
        ]

        const [custRes, servRes] = await Promise.all(promises)
        if (cancelled) return

        if (custRes.error || servRes.error) {
          const errMsg =
            custRes.error && servRes.error
              ? 'Could not load clothing items or services for this order. Please try again.'
              : custRes.error
              ? 'Could not load clothing items for this order. Please try again.'
              : 'Could not load service lines for this order. Please try again.'
          setLoadedDetailsError(errMsg)
          return
        }

        if (initialCustomerItems === undefined) {
          setLoadedCustomerItems((custRes.data as unknown as TransactionCustomerItem[]) ?? [])
        }
        if (initialServiceItems === undefined) {
          setLoadedServiceItems((servRes.data as unknown as TransactionServiceItem[]) ?? [])
        }
      } catch (err) {
        if (!cancelled) {
          setLoadedDetailsError(err instanceof Error ? err.message : 'Failed to load order details.')
        }
      } finally {
        if (!cancelled) setLoadingDetails(false)
      }
    }

    void fetchDetails()

    return () => {
      cancelled = true
    }
  }, [transaction.id, initialCustomerItems, initialServiceItems, initialCustomerItemsError, initialServiceItemsError, parentLoading])

  const handlePrint = async () => {
    if (isLoadingDetails) {
      setError('Order details are still loading. Please wait before printing.')
      return
    }
    if (detailsError) {
      setError(detailsError)
      return
    }

    // 1. Open popup synchronously during user gesture to avoid popup blocker
    const printWindow = window.open('', '_blank', 'width=450,height=720')
    if (!printWindow) {
      setError('Popup blocked. Please allow popups for Aquaspin to print thermal receipts.')
      return
    }

    // Initialize temporary loading placeholder in the opened popup
    try {
      printWindow.opener = null
      printWindow.document.write(
        '<!doctype html><html><head><title>Printing...</title></head><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#64748b;font-size:14px;background:#f8fafc;">Preparing receipt…</body></html>'
      )
      printWindow.document.close()
    } catch {
      // Ignore if document access fails
    }

    setPrinting(true)
    setError(null)

    try {
      let finalQrSvg = qrSvg
      let omitQr = false

      if (!finalQrSvg) {
        if (qrError) {
          // Explicitly omit QR when previous issuance failed and user chooses to print
          omitQr = true
        } else {
          const trackingUrl = await issueOrderTrackingLink(transaction.id)
          finalQrSvg = await generateQrSvg(trackingUrl)
          setQrSvg(finalQrSvg)
        }
      }

      await openThermalPrintWindow({
        transaction,
        customerItems,
        serviceItems,
        shopName: settings.shop_display_name,
        address: settings.address,
        contactPhone: settings.contact_phone,
        reportFooter: settings.report_footer,
        mode,
        paperWidth,
        targetWindow: printWindow,
        qrSvg: omitQr ? '' : finalQrSvg,
        omitQr,
      })
    } catch (err) {
      try {
        printWindow.close()
      } catch {
        // Ignore
      }
      setError(err instanceof Error ? err.message : 'Could not open print window. Please allow popups.')
    } finally {
      setPrinting(false)
    }
  }

  const activeCustomerItems = customerItems.filter((item) => Number(item.quantity || 0) > 0)
  const totalGarments = activeCustomerItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  const isDropOff = isDropOffTransaction(transaction)

  const primaryServiceName =
    transaction.service_label_snapshot ||
    transaction.services?.label ||
    transaction.service_code_snapshot ||
    transaction.services?.code ||
    'Laundry'

  const cashReceived = Number(transaction.cash_amount || 0)
  const totalAmount = Number(transaction.total_amount || 0)
  const cashChange = transaction.payment_method === 'paid' && cashReceived > totalAmount ? cashReceived - totalAmount : 0

  const primaryDetergentText = transaction.detergent_source === 'customer_supplied'
    ? 'Customer Supplied'
    : transaction.detergent_quantity ? `${transaction.detergent_quantity} dose/sachet` : null

  const primaryFabconText = transaction.fabric_conditioner_source === 'customer_supplied'
    ? 'Customer Supplied'
    : transaction.fabric_conditioner_quantity ? `${transaction.fabric_conditioner_quantity} ml/sachet` : null

  const totalOrderWeight = Number(transaction.kg || 0) + serviceItems.reduce((sum, item) => sum + Number(item.kg || 0), 0)
  const totalOrderLoads = Number(transaction.no_of_loads ?? 1) + serviceItems.reduce((sum, item) => sum + Number(item.no_of_loads ?? 1), 0)

  const renderReceiptPreview = () => (
    <div className="space-y-2">
      <div className="text-center">
        <div className="font-extrabold text-xs uppercase text-slate-900 dark:text-slate-100">
          {settings.shop_display_name || 'Aquaspin Laundry Station'}
        </div>
        {settings.address && (
          <div className="text-[9px] text-slate-600 dark:text-slate-400 mt-0.5">{settings.address}</div>
        )}
        {settings.contact_phone && (
          <div className="text-[9px] text-slate-600 dark:text-slate-400">Tel: {settings.contact_phone}</div>
        )}
      </div>

      <div className="border-t border-dashed border-slate-400 text-center py-1">
        <div className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold">CLAIM TICKET</div>
        <div className="font-black text-sm text-slate-900 dark:text-slate-100 tracking-wider">
          {transaction.transaction_code || `#${transaction.transaction_no}`}
        </div>
      </div>

      <div className="border-t border-dashed border-slate-400 pt-1 text-[10px] space-y-0.5 text-slate-700 dark:text-slate-300">
        <div className="flex justify-between">
          <span>Date:</span>
          <span>{transaction.transaction_date}</span>
        </div>
        <div className="flex justify-between font-bold text-slate-900 dark:text-slate-100">
          <span>Customer:</span>
          <span>{transaction.customer_name}</span>
        </div>
        {transaction.phone_number && (
          <div className="flex justify-between">
            <span>Phone:</span>
            <span>{transaction.phone_number}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Attendant:</span>
          <span>{transaction.created_by_profile?.full_name || 'Staff'}</span>
        </div>
      </div>

      <div className="border-t border-slate-800 dark:border-slate-300 pt-1 text-[10px]">
        <div className="flex justify-between pb-1 border-b border-slate-300 dark:border-slate-700 text-[9px] font-bold uppercase text-slate-500">
          <span>Description</span>
          <span>Amt</span>
        </div>
        <div className="pt-1 space-y-1">
          {/* Primary service line */}
          <div>
            <div className="flex justify-between font-bold text-slate-900 dark:text-slate-100">
              <span>{primaryServiceName}</span>
              <span>{peso(transaction.base_amount)}</span>
            </div>
            {transaction.kg != null && (
              <div className="text-[9px] text-slate-500">
                {transaction.kg} kg ({transaction.no_of_loads ?? 1} load{(transaction.no_of_loads ?? 1) > 1 ? 's' : ''})
              </div>
            )}
          </div>
          {transaction.add_on_items?.map((item, idx) => (
            <div key={`p-addon-${idx}`} className="flex justify-between text-[9px] text-slate-600 dark:text-slate-400 pl-2">
              <span>+ {item.name} ({item.quantity} {item.unit_type})</span>
              <span>{peso(item.line_total)}</span>
            </div>
          ))}

          {/* Additional service lines (PR #29) */}
          {serviceItems.map((item, idx) => (
            <div key={`serv-item-${item.id || idx}`} className="border-t border-dashed border-slate-200 dark:border-slate-800 pt-1 mt-1">
              <div className="flex justify-between font-bold text-slate-900 dark:text-slate-100">
                <span>{item.service_label_snapshot || item.service_code_snapshot || `Service ${idx + 2}`}</span>
                <span>{peso(item.base_amount)}</span>
              </div>
              {item.kg != null && (
                <div className="text-[9px] text-slate-500">
                  {item.kg} kg ({item.no_of_loads ?? 1} load{(item.no_of_loads ?? 1) > 1 ? 's' : ''})
                </div>
              )}
              {item.add_on_items?.map((addon, aIdx) => (
                <div key={`serv-addon-${aIdx}`} className="flex justify-between text-[9px] text-slate-600 dark:text-slate-400 pl-2">
                  <span>+ {addon.name} ({addon.quantity} {addon.unit_type})</span>
                  <span>{peso(addon.line_total)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {transaction.discount_amount > 0 && (
        <div className="border-t border-dashed border-slate-400 pt-1 text-[10px] flex justify-between text-slate-900 dark:text-slate-100">
          <span>Discount ({transaction.discount_promo_name_snapshot || 'Promo'}):</span>
          <span>-{peso(transaction.discount_amount)}</span>
        </div>
      )}

      <div className="border-t border-dashed border-slate-800 dark:border-slate-300 pt-1 flex justify-between font-black text-sm text-slate-900 dark:text-slate-100">
        <span>TOTAL{serviceItems.length > 0 ? ` (${serviceItems.length + 1} services)` : ''}:</span>
        <span>{peso(transaction.total_amount)}</span>
      </div>

      <div className="border-t border-dashed border-slate-400 pt-1 text-[10px] space-y-0.5 text-slate-700 dark:text-slate-300">
        <div className="flex justify-between">
          <span>Payment:</span>
          <span className="font-bold text-slate-900 dark:text-slate-100">{paymentLabel(transaction.payment_method)}</span>
        </div>
        {transaction.payment_method === 'paid' && cashReceived > 0 && (
          <>
            <div className="flex justify-between">
              <span>Tendered:</span>
              <span>{peso(cashReceived)}</span>
            </div>
            <div className="flex justify-between">
              <span>Change:</span>
              <span>{peso(cashChange)}</span>
            </div>
          </>
        )}
        {transaction.payment_method === 'gcash' && (
          <div className="flex justify-between">
            <span>GCash Ref:</span>
            <span className="font-semibold">{transaction.gcash_reference || '—'}</span>
          </div>
        )}
        {transaction.payment_method === 'pay_later' && (
          <div className="text-center border border-dashed border-slate-900 dark:border-slate-100 p-1 font-bold text-[9px] mt-1 text-slate-900 dark:text-slate-100">
            *** UNPAID - PAY ON PICKUP ***
          </div>
        )}
      </div>

      {transaction.pickup_date && (
        <div className="border-t border-dashed border-slate-400 pt-1 text-[9px] text-center text-slate-700 dark:text-slate-300">
          <strong>Target Ready:</strong> {transaction.pickup_date}
          {transaction.pickup_time ? ` @ ${transaction.pickup_time}` : ''}
        </div>
      )}

      <div className="border-t border-dashed border-slate-400 pt-2 text-center text-[9px] uppercase tracking-wider text-slate-600 dark:text-slate-400">
        {loadingQr ? (
          <div className="py-2 text-[9px] text-slate-500 italic">
            <span className="inline-block animate-pulse">Generating secure tracking QR…</span>
          </div>
        ) : qrSvg ? (
          <>
            <div className="w-20 h-20 mx-auto my-1 bg-white p-1 rounded" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <div className="text-[8px] mt-0.5">Scan to track live order status</div>
          </>
        ) : (
          <div className="py-2 text-[9px] text-amber-700 dark:text-amber-400 font-medium">
            [ Live tracking QR omitted ]
          </div>
        )}
      </div>

      <div className="border-t border-dashed border-slate-400 pt-1 text-[8px] text-center text-slate-500 leading-tight">
        <div>Recorded: {recordedLabel(transaction.created_at)}</div>
        <div className="mt-0.5">{settings.report_footer || 'Please present this slip upon pickup. Thank you for washing with us!'}</div>
      </div>
    </div>
  )

  const renderBagTagPreview = () => (
    <div className="space-y-2">
      <div className="text-center font-bold text-[9px] tracking-widest border-b-2 border-slate-900 dark:border-slate-100 pb-1 text-slate-900 dark:text-slate-100">
        *** SACK / BAG CLAIM TAG ***
      </div>
      <div className="text-center text-lg font-black tracking-wider text-slate-900 dark:text-slate-100">
        {transaction.transaction_code || `#${transaction.transaction_no}`}
      </div>

      <div className="border-t border-slate-900 dark:border-slate-100 pt-1">
        <div className="text-[9px] text-slate-500 uppercase">Customer:</div>
        <div className="text-sm font-black uppercase text-slate-900 dark:text-slate-100">{transaction.customer_name}</div>
        {transaction.phone_number && <div className="text-[10px] text-slate-600 dark:text-slate-400">Tel: {transaction.phone_number}</div>}
      </div>

      <div className="border-t border-slate-800 dark:border-slate-200 pt-1 text-[10px] space-y-0.5 text-slate-700 dark:text-slate-300">
        <div className="flex justify-between">
          <span>{serviceItems.length > 0 ? 'Service 1:' : 'Service:'}</span>
          <span className="font-bold text-slate-900 dark:text-slate-100">{primaryServiceName}</span>
        </div>
        <div className="flex justify-between">
          <span>Weight / Loads:</span>
          <span className="font-bold text-slate-900 dark:text-slate-100">
            {transaction.kg != null ? `${transaction.kg} kg` : '—'} · {transaction.no_of_loads ?? 1} Load{(transaction.no_of_loads ?? 1) > 1 ? 's' : ''}
          </span>
        </div>
        {primaryDetergentText && (
          <div className="flex justify-between">
            <span>Detergent:</span>
            <span>{primaryDetergentText}</span>
          </div>
        )}
        {primaryFabconText && (
          <div className="flex justify-between">
            <span>Fabcon:</span>
            <span>{primaryFabconText}</span>
          </div>
        )}

        {/* Additional service items on bag tag */}
        {serviceItems.map((item, idx) => {
          const itemDetergent = item.detergent_source === 'customer_supplied'
            ? 'Customer Supplied'
            : item.detergent_quantity ? `${item.detergent_quantity} dose/sachet` : null
          const itemFabcon = item.fabric_conditioner_source === 'customer_supplied'
            ? 'Customer Supplied'
            : item.fabric_conditioner_quantity ? `${item.fabric_conditioner_quantity} ml/sachet` : null

          return (
            <div key={`bag-serv-${item.id || idx}`} className="border-t border-dotted border-slate-300 dark:border-slate-700 pt-1 mt-1">
              <div className="flex justify-between">
                <span>Service {idx + 2}:</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">{item.service_label_snapshot || item.service_code_snapshot || `Service ${idx + 2}`}</span>
              </div>
              <div className="flex justify-between">
                <span>Weight / Loads:</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {item.kg != null ? `${item.kg} kg` : '—'} · {item.no_of_loads ?? 1} Load{(item.no_of_loads ?? 1) > 1 ? 's' : ''}
                </span>
              </div>
              {itemDetergent && (
                <div className="flex justify-between">
                  <span>Detergent:</span>
                  <span>{itemDetergent}</span>
                </div>
              )}
              {itemFabcon && (
                <div className="flex justify-between">
                  <span>Fabcon:</span>
                  <span>{itemFabcon}</span>
                </div>
              )}
            </div>
          )
        })}

        {serviceItems.length > 0 && (
          <div className="flex justify-between border-t border-dashed border-slate-900 dark:border-slate-100 pt-1 mt-1 font-bold text-slate-900 dark:text-slate-100">
            <span>Total Weight / Loads:</span>
            <span>{totalOrderWeight > 0 ? `${totalOrderWeight} kg` : '—'} · {totalOrderLoads} Loads</span>
          </div>
        )}
      </div>

      {/* Garment count section */}
      {totalGarments > 0 ? (
        <div className="border-t border-dashed border-slate-400 pt-1 text-[10px]">
          <span className="font-bold text-slate-900 dark:text-slate-100">GARMENT COUNT ({totalGarments} items):</span>
          <div className="text-[9px] text-slate-700 dark:text-slate-300 mt-0.5 leading-tight">
            {activeCustomerItems.map((item) => `${item.quantity}x ${item.custom_item_name || item.item_type.replace('_', ' ')}`).join(', ')}
          </div>
        </div>
      ) : isDropOff ? (
        <div className="border-t border-dashed border-slate-400 pt-1">
          <div className="border border-dashed border-slate-800 dark:border-slate-300 p-1.5 text-center">
            <div className="font-bold text-[9px] text-slate-900 dark:text-slate-100 uppercase">
              *** NO GARMENT COUNT RECORDED ***
            </div>
            <div className="text-[8px] text-slate-500 mt-0.5">
              Clothing items pending count / check-in
            </div>
          </div>
        </div>
      ) : null}

      {transaction.notes && (
        <div className="border-t border-dashed border-slate-400 pt-1 text-[9px] text-slate-700 dark:text-slate-300">
          <strong>Special Instructions:</strong>
          <div className="italic text-[9px] text-slate-800 dark:text-slate-200 mt-0.5">{transaction.notes}</div>
        </div>
      )}

      <div className="border-t border-slate-800 dark:border-slate-200 pt-1 flex justify-between font-bold text-[10px] text-slate-900 dark:text-slate-100">
        <span>Status / Balance:</span>
        <span>
          {transaction.payment_method === 'pay_later'
            ? `UNPAID (${peso(transaction.total_amount)})`
            : `PAID (${paymentLabel(transaction.payment_method)})`}
        </span>
      </div>

      {transaction.pickup_date && (
        <div className="flex justify-between text-[9px] text-slate-700 dark:text-slate-300">
          <span>Target Pickup:</span>
          <span className="font-bold">{transaction.pickup_date}{transaction.pickup_time ? ` ${transaction.pickup_time}` : ''}</span>
        </div>
      )}

      <div className="border-t border-dashed border-slate-400 pt-2 text-center text-[9px] uppercase tracking-wider text-slate-600 dark:text-slate-400">
        {loadingQr ? (
          <div className="py-2 text-[9px] text-slate-500 italic">
            <span className="inline-block animate-pulse">Generating claim QR…</span>
          </div>
        ) : qrSvg ? (
          <>
            <div className="w-18 h-18 mx-auto my-1 bg-white p-1 rounded" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <div className="text-[8px] mt-0.5">Claim Scan Code</div>
          </>
        ) : (
          <div className="py-2 text-[9px] text-amber-700 dark:text-amber-400 font-medium">
            [ Claim QR code omitted ]
          </div>
        )}
      </div>
    </div>
  )

  const previewWidthClass = paperWidth === '80mm' ? 'max-w-[340px]' : 'max-w-[280px]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 dark:border dark:border-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
              <UiIcon name="printer" size={18} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Thermal Print &amp; Bag Tag</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Continuous POS slip for {transaction.transaction_code || `#${transaction.transaction_no}`}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        {/* Configuration Options */}
        <div className="space-y-4 border-b border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
          {error && <InlineAlert variant="error" title="Print Error">{error}</InlineAlert>}
          {detailsError && <InlineAlert variant="error" title="Data Load Error">{detailsError}</InlineAlert>}
          {qrError && (
            <InlineAlert
              variant="warning"
              title="Tracking QR Omitted"
              actionLabel={loadingQr ? 'Retrying…' : 'Retry QR'}
              onAction={() => void handleRetryQr()}
            >
              {qrError} Receipts can still be printed, but the live tracking QR will be omitted.
            </InlineAlert>
          )}

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Print Slip Type</label>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setMode('receipt')}
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  mode === 'receipt'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                Customer Receipt
              </button>
              <button
                type="button"
                onClick={() => setMode('bag_tag')}
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  mode === 'bag_tag'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                Bag Tag Slip
              </button>
              <button
                type="button"
                onClick={() => setMode('both')}
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  mode === 'both'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                Print Both
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Paper Roll Width:</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPaperWidth('58mm')}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  paperWidth === '58mm'
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                58 mm (Standard)
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth('80mm')}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  paperWidth === '80mm'
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                80 mm (Wide)
              </button>
            </div>
          </div>
        </div>

        {/* Live Preview Area */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-100 dark:bg-slate-950">
          {isLoadingDetails ? (
            <div className="flex flex-col items-center justify-center p-8 text-center text-slate-500">
              <ButtonSpinner />
              <p className="mt-3 text-xs">Loading order clothing items and services…</p>
            </div>
          ) : detailsError ? (
            <div className="flex flex-col items-center justify-center p-8 text-center text-slate-500">
              <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-300 max-w-sm">
                <p className="font-semibold text-sm">Cannot Generate Slip</p>
                <p className="mt-1 text-xs">{detailsError}</p>
                <p className="mt-2 text-[11px] text-red-600/80 dark:text-red-400/80">
                  Printing is disabled to prevent producing slips with incomplete items or services.
                </p>
              </div>
            </div>
          ) : (
            <div className={`mx-auto ${previewWidthClass} rounded-lg border border-slate-300 bg-white p-4 font-mono text-xs text-slate-900 shadow-md dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 transition-all`}>
              {mode === 'receipt' && renderReceiptPreview()}
              {mode === 'bag_tag' && renderBagTagPreview()}
              {mode === 'both' && (
                <div className="space-y-4">
                  {renderReceiptPreview()}
                  <div className="my-3 border-b-2 border-dashed border-slate-400 text-center text-[8px] uppercase tracking-widest text-slate-400">
                    ✂ Tear / Page Break ✂
                  </div>
                  {renderBagTagPreview()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={printing || isLoadingDetails || !canPrintDetails(customerItems, serviceItems, detailsError, isLoadingDetails)}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-sky-500 disabled:opacity-60"
          >
            {printing ? (
              <>
                <ButtonSpinner />
                <span>Preparing…</span>
              </>
            ) : (
              <>
                <UiIcon name="printer" size={16} />
                <span>
                  {isLoadingDetails
                    ? 'Loading details…'
                    : detailsError
                    ? 'Print Disabled'
                    : qrError
                    ? `Print ${mode === 'bag_tag' ? 'Bag Tag' : mode === 'both' ? 'Both Slips' : 'Receipt'} (No QR)`
                    : `Print ${mode === 'bag_tag' ? 'Bag Tag' : mode === 'both' ? 'Both Slips' : 'Receipt'}`}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
