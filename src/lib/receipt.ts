import type { PaymentMethod, TransactionWithService } from '../types/database'

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

type ReceiptOptions = {
  transaction: TransactionWithService
  shopName?: string
  address?: string | null
  contactPhone?: string | null
  logoUrl?: string | null
  reportFooter?: string | null
}

const recordedLabel = (value: string) =>
  new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })

export function openTransactionReceipt({
  transaction,
  shopName = import.meta.env.VITE_SHOP_NAME || 'Aquaspin Laundry Station',
  address,
  contactPhone,
  logoUrl,
  reportFooter,
}: ReceiptOptions) {
  const serviceName = transaction.service_label_snapshot || transaction.services?.label || transaction.service_code_snapshot || transaction.services?.code || 'Laundry service'
  const addOnRows = transaction.add_on_items?.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)} <span class="muted">(${escapeHtml(item.quantity)} × ${escapeHtml(item.unit_type)})</span></td>
      <td class="num">${escapeHtml(peso(item.line_total))}</td>
    </tr>`).join('') ?? ''
  const receiptTitle = `receipt-${transaction.transaction_code || transaction.transaction_no}`
  const receiptWindow = window.open('', '_blank', 'width=480,height=760')

  if (!receiptWindow) {
    throw new Error('Popup blocked. Allow popups for Aquaspin, then try Print Receipt again.')
  }
  receiptWindow.opener = null

  receiptWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(receiptTitle)}</title>
  <style>
    @page { size: auto; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0 auto; max-width: 420px; font-size: 12px; }
    .brand { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #cbd5e1; padding-bottom: 12px; }
    .brand-logo { width: 52px; height: 52px; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 10px; padding: 4px; }
    h1 { margin: 0; font-size: 20px; }
    .muted { color: #64748b; }
    .contact { margin-top: 3px; color: #475569; }
    .meta { display: grid; gap: 5px; margin: 14px 0; }
    .row { display: flex; justify-content: space-between; gap: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 7px 0; text-align: left; vertical-align: top; }
    th { color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .num { text-align: right; white-space: nowrap; }
    .total { margin-top: 12px; border-top: 2px solid #0f172a; padding-top: 10px; font-size: 16px; font-weight: 700; }
    .footer { margin-top: 22px; border-top: 1px solid #cbd5e1; padding-top: 10px; color: #64748b; font-size: 10px; text-align: center; white-space: pre-wrap; }
    @media print { button { display: none !important; } body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="brand">
    ${logoUrl ? `<img class="brand-logo" src="${escapeHtml(logoUrl)}" alt="Shop logo" />` : ''}
    <div>
      <h1>${escapeHtml(shopName)}</h1>
      ${address ? `<div class="muted">${escapeHtml(address)}</div>` : ''}
      ${contactPhone ? `<div class="contact">${escapeHtml(contactPhone)}</div>` : ''}
    </div>
  </div>

  <div class="meta">
    <div class="row"><strong>Transaction</strong><span>${escapeHtml(transaction.transaction_code || `#${transaction.transaction_no}`)}</span></div>
    <div class="row"><strong>Date</strong><span>${escapeHtml(transaction.transaction_date)}</span></div>
    <div class="row"><strong>Customer</strong><span>${escapeHtml(transaction.customer_name)}</span></div>
    <div class="row"><strong>Processed by</strong><span>${escapeHtml(transaction.created_by_profile?.full_name || '—')}</span></div>
  </div>

  <table>
    <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
    <tbody>
      <tr><td>${escapeHtml(serviceName)}</td><td class="num">${escapeHtml(peso(transaction.base_amount))}</td></tr>
      ${addOnRows || '<tr><td class="muted">No add-ons</td><td class="num">—</td></tr>'}
    </tbody>
  </table>

  <div class="meta">
    <div class="row"><strong>Weight</strong><span>${escapeHtml(transaction.kg != null ? `${transaction.kg} kg` : '—')}</span></div>
    <div class="row"><strong>Loads</strong><span>${escapeHtml(transaction.no_of_loads ?? '—')}</span></div>
    <div class="row"><strong>Payment</strong><span>${escapeHtml(paymentLabel(transaction.payment_method))}</span></div>
    ${transaction.payment_method === 'gcash' ? `<div class="row"><strong>GCash reference</strong><span>${escapeHtml(transaction.gcash_reference || '—')}</span></div>` : ''}
    <div class="row total"><span>Total</span><span>${escapeHtml(peso(transaction.total_amount))}</span></div>
  </div>

  <div class="muted">Recorded ${escapeHtml(recordedLabel(transaction.created_at))}</div>
  <div class="footer">${escapeHtml(reportFooter || 'Thank you for choosing Aquaspin Laundry Station.')}</div>
  <script>
    window.addEventListener('load', () => setTimeout(() => window.print(), 250))
  </script>
</body>
</html>`)
  receiptWindow.document.close()
}

