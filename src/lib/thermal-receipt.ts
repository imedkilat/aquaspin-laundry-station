import type { PaymentMethod, TransactionWithService, TransactionCustomerItem } from '../types/database'
import { generateQrSvg } from './qr-code'

export type ThermalPrintMode = 'receipt' | 'bag_tag' | 'both'
export type ThermalPaperWidth = '58mm' | '80mm'

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

const peso = (value: number) =>
  `₱${Number(value || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const paymentLabel = (method: PaymentMethod) => {
  if (method === 'paid') return 'Cash'
  if (method === 'gcash') return 'GCash'
  return 'Pay Later'
}

const recordedLabel = (value: string) =>
  new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })

export type ThermalPrintOptions = {
  transaction: TransactionWithService
  customerItems?: TransactionCustomerItem[]
  shopName?: string
  address?: string | null
  contactPhone?: string | null
  reportFooter?: string | null
  mode?: ThermalPrintMode
  paperWidth?: ThermalPaperWidth
}

export async function openThermalPrintWindow({
  transaction,
  customerItems = [],
  shopName = import.meta.env.VITE_SHOP_NAME || 'Aquaspin Laundry Station',
  address,
  contactPhone,
  reportFooter,
  mode = 'receipt',
  paperWidth = '58mm',
}: ThermalPrintOptions) {
  const serviceName =
    transaction.service_label_snapshot ||
    transaction.services?.label ||
    transaction.service_code_snapshot ||
    transaction.services?.code ||
    'Laundry service'

  const trackingUrl = `${window.location.origin}/track/${transaction.transaction_code || transaction.transaction_no}`
  const qrSvg = await generateQrSvg(trackingUrl)

  const printAreaWidth = paperWidth === '80mm' ? '72mm' : '48mm'
  const is58 = paperWidth === '58mm'
  const baseFontSize = is58 ? '11px' : '12px'

  // Format Add-ons
  const addOnRows = transaction.add_on_items?.map((item) => `
    <tr>
      <td style="padding: 2px 0;">${escapeHtml(item.name)} <span style="font-size: 9px; color: #555;">(${escapeHtml(item.quantity)} ${escapeHtml(item.unit_type)})</span></td>
      <td style="text-align: right; padding: 2px 0; white-space: nowrap;">${escapeHtml(peso(item.line_total))}</td>
    </tr>`).join('') ?? ''

  // Format Detergent & Fabcon summary
  const detergentText = transaction.detergent_source === 'customer_supplied'
    ? 'Customer Supplied'
    : transaction.detergent_quantity ? `${transaction.detergent_quantity} dose/sachet` : null

  const fabconText = transaction.fabric_conditioner_source === 'customer_supplied'
    ? 'Customer Supplied'
    : transaction.fabric_conditioner_quantity ? `${transaction.fabric_conditioner_quantity} ml/sachet` : null

  // Format Customer Items
  const customerItemRows = customerItems.map((ci) => {
    const label = ci.custom_item_name || ci.item_type.replace('_', ' ')
    return `<span style="display: inline-block; margin-right: 6px; font-size: 10px;">${escapeHtml(ci.quantity)}x ${escapeHtml(label)}</span>`
  }).join(', ')

  const totalGarments = customerItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)

  // Payment Breakdown
  const cashReceived = Number(transaction.cash_amount || 0)
  const totalAmount = Number(transaction.total_amount || 0)
  const cashChange = transaction.payment_method === 'paid' && cashReceived > totalAmount ? cashReceived - totalAmount : 0

  const receiptHtml = `
    <div class="slip receipt-slip">
      <div style="text-align: center; margin-bottom: 8px;">
        <div style="font-size: ${is58 ? '13px' : '15px'}; font-weight: 800; text-transform: uppercase;">${escapeHtml(shopName)}</div>
        ${address ? `<div style="font-size: 9px; color: #333; margin-top: 2px;">${escapeHtml(address)}</div>` : ''}
        ${contactPhone ? `<div style="font-size: 9px; color: #333;">Tel: ${escapeHtml(contactPhone)}</div>` : ''}
      </div>

      <div class="divider-dashed"></div>

      <div style="text-align: center; margin: 6px 0;">
        <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: #555;">CLAIM TICKET</div>
        <div style="font-size: 16px; font-weight: 800; letter-spacing: 0.08em; margin: 2px 0;">${escapeHtml(transaction.transaction_code || `#${transaction.transaction_no}`)}</div>
      </div>

      <div class="divider-dashed"></div>

      <div style="margin: 6px 0; font-size: 10px; line-height: 1.4;">
        <div class="flex-row"><span>Date:</span><span>${escapeHtml(transaction.transaction_date)}</span></div>
        <div class="flex-row"><span>Customer:</span><span style="font-weight: 700;">${escapeHtml(transaction.customer_name)}</span></div>
        ${transaction.phone_number ? `<div class="flex-row"><span>Phone:</span><span>${escapeHtml(transaction.phone_number)}</span></div>` : ''}
        <div class="flex-row"><span>Attendant:</span><span>${escapeHtml(transaction.created_by_profile?.full_name || 'Staff')}</span></div>
      </div>

      <div class="divider-solid"></div>

      <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin: 4px 0;">
        <thead>
          <tr style="border-bottom: 1px solid #000; text-align: left; font-size: 9px;">
            <th style="padding-bottom: 3px;">DESCRIPTION</th>
            <th style="text-align: right; padding-bottom: 3px;">AMT</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 3px 0;">
              ${escapeHtml(serviceName)}
              ${transaction.kg ? `<br><span style="font-size: 9px; color: #444;">${transaction.kg} kg (${transaction.no_of_loads ?? 1} load${(transaction.no_of_loads ?? 1) > 1 ? 's' : ''})</span>` : ''}
            </td>
            <td style="text-align: right; padding: 3px 0; vertical-align: top;">${escapeHtml(peso(transaction.base_amount))}</td>
          </tr>
          ${addOnRows}
        </tbody>
      </table>

      ${transaction.discount_amount > 0 ? `
        <div class="flex-row" style="font-size: 10px; color: #000; margin: 2px 0;">
          <span>Discount (${escapeHtml(transaction.discount_promo_name_snapshot || 'Promo')}):</span>
          <span>-${escapeHtml(peso(transaction.discount_amount))}</span>
        </div>
      ` : ''}

      <div class="divider-dashed"></div>

      <div class="flex-row" style="font-size: 13px; font-weight: 800; margin: 4px 0;">
        <span>TOTAL AMOUNT:</span>
        <span>${escapeHtml(peso(transaction.total_amount))}</span>
      </div>

      <div style="font-size: 10px; margin: 4px 0; line-height: 1.4;">
        <div class="flex-row"><span>Payment:</span><span style="font-weight: 700;">${escapeHtml(paymentLabel(transaction.payment_method))}</span></div>
        ${transaction.payment_method === 'paid' && cashReceived > 0 ? `
          <div class="flex-row"><span>Tendered:</span><span>${escapeHtml(peso(cashReceived))}</span></div>
          <div class="flex-row"><span>Change:</span><span>${escapeHtml(peso(cashChange))}</span></div>
        ` : ''}
        ${transaction.payment_method === 'gcash' ? `
          <div class="flex-row"><span>GCash Ref:</span><span style="font-weight: 600;">${escapeHtml(transaction.gcash_reference || '—')}</span></div>
        ` : ''}
        ${transaction.payment_method === 'pay_later' ? `
          <div style="text-align: center; border: 1px dashed #000; padding: 4px; font-weight: 700; margin-top: 4px;">
            *** UNPAID - PAY ON PICKUP ***
          </div>
        ` : ''}
      </div>

      ${transaction.pickup_date ? `
        <div class="divider-dashed"></div>
        <div style="font-size: 10px; text-align: center; margin: 4px 0;">
          <strong>Target Ready:</strong> ${escapeHtml(transaction.pickup_date)}${transaction.pickup_time ? ` @ ${escapeHtml(transaction.pickup_time)}` : ''}
        </div>
      ` : ''}

      ${qrSvg ? `
        <div class="divider-dashed"></div>
        <div style="text-align: center; margin: 6px 0;">
          <div style="width: ${is58 ? '100px' : '115px'}; height: ${is58 ? '100px' : '115px'}; margin: 0 auto;">
            ${qrSvg}
          </div>
          <div style="font-size: 8px; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.04em;">Scan to track live order status</div>
        </div>
      ` : ''}

      <div class="divider-dashed"></div>
      <div style="font-size: 8px; text-align: center; color: #444; margin-top: 6px; line-height: 1.3;">
        <div>Recorded: ${escapeHtml(recordedLabel(transaction.created_at))}</div>
        ${escapeHtml(reportFooter || 'Please present this slip upon pickup. Thank you for washing with us!')}
      </div>
    </div>
  `

  const bagTagHtml = `
    <div class="slip bag-tag-slip">
      <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 6px;">
        <div style="font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">*** SACK / BAG CLAIM TAG ***</div>
        <div style="font-size: ${is58 ? '17px' : '20px'}; font-weight: 900; letter-spacing: 0.06em; margin: 2px 0;">
          ${escapeHtml(transaction.transaction_code || `#${transaction.transaction_no}`)}
        </div>
      </div>

      <div style="margin: 6px 0;">
        <div style="font-size: 9px; text-transform: uppercase; color: #444;">Customer:</div>
        <div style="font-size: ${is58 ? '14px' : '16px'}; font-weight: 900; text-transform: uppercase;">
          ${escapeHtml(transaction.customer_name)}
        </div>
        ${transaction.phone_number ? `<div style="font-size: 10px; font-weight: 600;">Tel: ${escapeHtml(transaction.phone_number)}</div>` : ''}
      </div>

      <div class="divider-solid"></div>

      <div style="font-size: 10px; line-height: 1.4; margin: 5px 0;">
        <div class="flex-row">
          <span>Service:</span>
          <span style="font-weight: 700;">${escapeHtml(serviceName)}</span>
        </div>
        <div class="flex-row">
          <span>Weight / Loads:</span>
          <span style="font-weight: 800;">${transaction.kg ? `${transaction.kg} kg` : '—'} · ${transaction.no_of_loads ?? 1} Load${(transaction.no_of_loads ?? 1) > 1 ? 's' : ''}</span>
        </div>
        ${detergentText ? `<div class="flex-row"><span>Detergent:</span><span>${escapeHtml(detergentText)}</span></div>` : ''}
        ${fabconText ? `<div class="flex-row"><span>Fabcon:</span><span>${escapeHtml(fabconText)}</span></div>` : ''}
      </div>

      ${totalGarments > 0 ? `
        <div class="divider-dashed"></div>
        <div style="margin: 4px 0;">
          <div style="font-size: 9px; font-weight: 800; text-transform: uppercase;">Garment Count (${totalGarments} items):</div>
          <div style="font-size: 10px; line-height: 1.3; margin-top: 2px; color: #111;">
            ${customerItemRows}
          </div>
        </div>
      ` : ''}

      ${transaction.notes ? `
        <div class="divider-dashed"></div>
        <div style="font-size: 9px; margin: 4px 0;">
          <strong>Special Instructions:</strong><br>
          <span style="font-size: 10px; font-style: italic;">${escapeHtml(transaction.notes)}</span>
        </div>
      ` : ''}

      <div class="divider-solid"></div>

      <div style="margin: 5px 0; font-size: 10px;">
        <div class="flex-row">
          <span>Status / Balance:</span>
          <span style="font-weight: 800;">
            ${transaction.payment_method === 'pay_later' ? `UNPAID (${peso(transaction.total_amount)})` : `PAID (${paymentLabel(transaction.payment_method)})`}
          </span>
        </div>
        ${transaction.pickup_date ? `
          <div class="flex-row" style="margin-top: 2px;">
            <span>Target Pickup:</span>
            <span style="font-weight: 700;">${escapeHtml(transaction.pickup_date)}${transaction.pickup_time ? ` ${escapeHtml(transaction.pickup_time)}` : ''}</span>
          </div>
        ` : ''}
      </div>

      ${qrSvg ? `
        <div style="text-align: center; margin-top: 6px; border-top: 1px dashed #000; padding-top: 6px;">
          <div style="width: ${is58 ? '90px' : '105px'}; height: ${is58 ? '90px' : '105px'}; margin: 0 auto;">
            ${qrSvg}
          </div>
          <div style="font-size: 8px; text-transform: uppercase; margin-top: 2px;">Claim Scan Code</div>
        </div>
      ` : ''}
    </div>
  `

  let contentHtml = ''
  if (mode === 'receipt') {
    contentHtml = receiptHtml
  } else if (mode === 'bag_tag') {
    contentHtml = bagTagHtml
  } else {
    contentHtml = `${receiptHtml}<div class="page-break"></div>${bagTagHtml}`
  }

  const printWindow = window.open('', '_blank', `width=450,height=720`)
  if (!printWindow) {
    throw new Error('Popup blocked. Allow popups for Aquaspin to print thermal receipts.')
  }
  printWindow.opener = null

  printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>thermal-${transaction.transaction_code || transaction.transaction_no}</title>
  <style>
    @page {
      size: ${paperWidth} auto;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      margin: 0;
      padding: 0;
      background: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, monospace, sans-serif;
      color: #000;
      font-size: ${baseFontSize};
    }
    .print-container {
      width: ${printAreaWidth};
      margin: 10px auto;
      background: #fff;
      padding: 6px 4px;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
    }
    .slip {
      padding: 4px 2px;
    }
    .divider-solid {
      border-top: 1.5px solid #000;
      margin: 5px 0;
    }
    .divider-dashed {
      border-top: 1px dashed #000;
      margin: 5px 0;
    }
    .flex-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 4px;
    }
    .page-break {
      page-break-after: always;
      break-after: page;
      height: 12px;
      border-bottom: 2px dashed #999;
      margin: 16px 0;
    }
    .actions-bar {
      text-align: center;
      padding: 8px;
      background: #0284c7;
      color: #fff;
      font-size: 13px;
      position: sticky;
      top: 0;
      display: flex;
      justify-content: center;
      gap: 12px;
      align-items: center;
    }
    .btn-print {
      background: #fff;
      color: #0284c7;
      border: none;
      border-radius: 6px;
      font-weight: 700;
      padding: 6px 16px;
      cursor: pointer;
      font-size: 13px;
    }
    @media print {
      body {
        background: #fff;
      }
      .print-container {
        border: none;
        padding: 0;
        margin: 0 auto;
        width: 100%;
      }
      .actions-bar {
        display: none !important;
      }
      .page-break {
        border: none;
        margin: 0;
        height: 0;
      }
    }
  </style>
</head>
<body>
  <div class="actions-bar">
    <span>Ready to print (${paperWidth})</span>
    <button class="btn-print" onclick="window.print()">Print Now</button>
  </div>
  <div class="print-container">
    ${contentHtml}
  </div>
  <script>
    window.addEventListener('load', () => {
      setTimeout(() => {
        window.print();
      }, 350);
    });
  </script>
</body>
</html>`)
  printWindow.document.close()
}
