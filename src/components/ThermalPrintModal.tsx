import { useState } from 'react'
import type { TransactionWithService, TransactionCustomerItem } from '../types/database'
import { openThermalPrintWindow, type ThermalPaperWidth, type ThermalPrintMode } from '../lib/thermal-receipt'
import { useShopSettings } from '../lib/shop-settings-context'
import UiIcon from './UiIcon'
import { ButtonSpinner, InlineAlert } from './UiFeedback'

export default function ThermalPrintModal({
  transaction,
  customerItems = [],
  onClose,
}: {
  transaction: TransactionWithService
  customerItems?: TransactionCustomerItem[]
  onClose: () => void
}) {
  const { settings } = useShopSettings()
  const [mode, setMode] = useState<ThermalPrintMode>('receipt')
  const [paperWidth, setPaperWidth] = useState<ThermalPaperWidth>('58mm')
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePrint = async () => {
    setPrinting(true)
    setError(null)
    try {
      await openThermalPrintWindow({
        transaction,
        customerItems,
        shopName: settings.shop_display_name,
        address: settings.address,
        contactPhone: settings.contact_phone,
        reportFooter: settings.report_footer,
        mode,
        paperWidth,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open print window. Please allow popups.')
    } finally {
      setPrinting(false)
    }
  }

  const peso = (val: number) =>
    `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const totalGarments = customerItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)

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
          <div className="mx-auto max-w-[280px] rounded-lg border border-slate-300 bg-white p-4 font-mono text-xs text-slate-900 shadow-md">
            {mode === 'bag_tag' ? (
              <div className="space-y-2">
                <div className="text-center font-bold text-[10px] tracking-widest border-b border-black pb-1">
                  *** SACK / BAG CLAIM TAG ***
                </div>
                <div className="text-center text-lg font-black tracking-wider">
                  {transaction.transaction_code || `#${transaction.transaction_no}`}
                </div>
                <div className="border-t border-black pt-1">
                  <div className="text-[10px] text-slate-500 uppercase">Customer:</div>
                  <div className="text-sm font-black uppercase">{transaction.customer_name}</div>
                  {transaction.phone_number && <div className="text-[10px]">{transaction.phone_number}</div>}
                </div>
                <div className="border-t border-dashed border-black pt-1 text-[11px] space-y-0.5">
                  <div className="flex justify-between">
                    <span>Service:</span>
                    <span className="font-bold">{transaction.service_label_snapshot || transaction.services?.label || 'Laundry'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Weight/Loads:</span>
                    <span className="font-bold">{transaction.kg ? `${transaction.kg} kg` : '—'} ({transaction.no_of_loads ?? 1} load)</span>
                  </div>
                </div>
                {totalGarments > 0 && (
                  <div className="border-t border-dashed border-black pt-1 text-[10px]">
                    <span className="font-bold">GARMENT COUNT ({totalGarments} pcs):</span>
                    <div className="text-[9px] text-slate-700 mt-0.5">
                      {customerItems.map((item) => `${item.quantity}x ${item.custom_item_name || item.item_type}`).join(', ')}
                    </div>
                  </div>
                )}
                <div className="border-t border-black pt-1 flex justify-between font-bold text-[11px]">
                  <span>Status:</span>
                  <span>{transaction.payment_method === 'pay_later' ? `UNPAID (${peso(transaction.total_amount)})` : 'PAID'}</span>
                </div>
                <div className="border-t border-dashed border-black pt-2 text-center text-[9px] uppercase tracking-wider text-slate-600">
                  [ QR Code Claim Stub Included ]
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-center font-bold text-xs uppercase">
                  {settings.shop_display_name || 'Aquaspin Laundry'}
                </div>
                <div className="text-center text-[9px] text-slate-600">
                  {settings.address || 'Laundry Station'}
                </div>
                <div className="border-t border-dashed border-black text-center py-1">
                  <div className="text-[9px] text-slate-500 uppercase">Claim Ticket</div>
                  <div className="font-bold text-sm">{transaction.transaction_code || `#${transaction.transaction_no}`}</div>
                </div>
                <div className="border-t border-dashed border-black pt-1 text-[10px] space-y-0.5">
                  <div className="flex justify-between">
                    <span>Date:</span>
                    <span>{transaction.transaction_date}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Customer:</span>
                    <span>{transaction.customer_name}</span>
                  </div>
                </div>
                <div className="border-t border-black pt-1 text-[11px] space-y-0.5">
                  <div className="flex justify-between">
                    <span>{transaction.service_label_snapshot || transaction.services?.label || 'Service'}</span>
                    <span>{peso(transaction.base_amount)}</span>
                  </div>
                  {transaction.add_on_items?.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-[10px] text-slate-600">
                      <span>+ {item.name} ({item.quantity})</span>
                      <span>{peso(item.line_total)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-black pt-1 flex justify-between font-extrabold text-sm">
                  <span>TOTAL:</span>
                  <span>{peso(transaction.total_amount)}</span>
                </div>
                <div className="border-t border-dashed border-black pt-1 text-[10px] flex justify-between">
                  <span>Payment:</span>
                  <span className="font-bold uppercase">{transaction.payment_method === 'paid' ? 'Cash' : transaction.payment_method}</span>
                </div>
                <div className="border-t border-dashed border-black pt-2 text-center text-[9px] uppercase tracking-wider text-slate-600">
                  [ QR Code for Tracking Included ]
                </div>
              </div>
            )}
          </div>
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
            disabled={printing}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-sky-500 disabled:opacity-60"
          >
            {printing ? <ButtonSpinner /> : <UiIcon name="printer" size={16} />}
            {printing ? 'Preparing…' : `Print ${mode === 'bag_tag' ? 'Bag Tag' : mode === 'both' ? 'Both Slips' : 'Receipt'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
