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

const pickupLabel = (row: TransactionWithService) => {
  if (!row.pickup_date) return '—'
  if (!row.pickup_time) return row.pickup_date
  const [hourText, minute = '00'] = row.pickup_time.split(':')
  const hour = Number(hourText)
  if (!Number.isFinite(hour)) return `${row.pickup_date} ${row.pickup_time}`
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${row.pickup_date} ${displayHour}:${minute} ${suffix}`
}

type PdfReportOptions = {
  rows: TransactionWithService[]
  dateFrom: string
  dateTo: string
  paymentMethod: PaymentMethod | 'all'
  search: string
  shopName?: string
  contactPhone?: string | null
  reportFooter?: string | null
}

export function openTransactionPdfReport({
  rows,
  dateFrom,
  dateTo,
  paymentMethod,
  search,
  shopName = import.meta.env.VITE_SHOP_NAME || 'Aquaspin Laundry Station',
  contactPhone,
  reportFooter,
}: PdfReportOptions) {
  const activeRows = rows.filter((row) => !row.deleted_at)
  const sales = activeRows.reduce((sum, row) => sum + (row.total_amount || 0), 0)
  const cash = activeRows
    .filter((row) => row.payment_method === 'paid')
    .reduce((sum, row) => sum + (row.total_amount || 0), 0)
  const gcash = activeRows
    .filter((row) => row.payment_method === 'gcash')
    .reduce((sum, row) => sum + (row.total_amount || 0), 0)
  const payLater = activeRows
    .filter((row) => row.payment_method === 'pay_later')
    .reduce((sum, row) => sum + (row.total_amount || 0), 0)

  const filterLabel = paymentMethod === 'all' ? 'All payments' : paymentLabel(paymentMethod)
  const filename = `aquaspin-report-${dateFrom}-to-${dateTo}`
  const logoUrl = document.querySelector<HTMLImageElement>('header img[alt$=" logo"]')?.src ?? null

  const tableRows = activeRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.transaction_code || row.transaction_no)}</td>
          <td>${escapeHtml(row.transaction_date)}</td>
          <td>${escapeHtml(row.customer_name)}</td>
          <td>${escapeHtml(row.phone_number || '—')}</td>
          <td>${escapeHtml(row.services?.code || '—')}</td>
          <td class="num">${escapeHtml(row.kg ?? '—')}</td>
          <td class="num">${escapeHtml(row.no_of_loads ?? '—')}</td>
          <td class="num">${escapeHtml(peso(row.add_ons || 0))}</td>
          <td class="num strong">${escapeHtml(peso(row.total_amount || 0))}</td>
          <td>${escapeHtml(paymentLabel(row.payment_method))}</td>
          <td>${escapeHtml(row.payment_method === 'gcash' ? row.gcash_reference || '—' : '—')}</td>
          <td>${escapeHtml(pickupLabel(row))}</td>
        </tr>`
    )
    .join('')

  const reportWindow = window.open('', '_blank')
  if (!reportWindow) {
    throw new Error('Popup blocked. Allow popups for Aquaspin, then try Export PDF again.')
  }
  reportWindow.opener = null

  reportWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(filename)}</title>
  <style>
    @page { size: landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; font-size: 11px; }
    h1 { margin: 0; font-size: 22px; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-logo { width: 48px; height: 48px; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 10px; padding: 4px; }
    .sub { color: #64748b; margin-top: 4px; }
    .contact { color: #475569; margin-top: 3px; }
    .meta { margin-top: 12px; display: flex; gap: 18px; flex-wrap: wrap; color: #334155; }
    .stats { margin: 18px 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .stat { border: 1px solid #cbd5e1; border-radius: 8px; padding: 9px; }
    .stat span { display: block; color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
    .stat strong { display: block; margin-top: 3px; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; table-layout: auto; }
    th { background: #f1f5f9; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .03em; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 6px 5px; vertical-align: top; white-space: nowrap; }
    td.num { text-align: right; }
    td.strong { font-weight: 700; }
    .empty { padding: 30px; text-align: center; color: #64748b; border: 1px dashed #cbd5e1; }
    .footer { margin-top: 16px; color: #64748b; font-size: 9px; }
    @media print {
      button { display: none !important; }
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="brand">
    ${logoUrl ? `<img class="brand-logo" src="${escapeHtml(logoUrl)}" alt="Shop logo" />` : ''}
    <div>
      <h1>${escapeHtml(shopName)}</h1>
      <div class="sub">Transaction Report</div>
      ${contactPhone ? `<div class="contact">Contact: ${escapeHtml(contactPhone)}</div>` : ''}
    </div>
  </div>
  <div class="meta">
    <div><strong>Period:</strong> ${escapeHtml(dateFrom)} to ${escapeHtml(dateTo)}</div>
    <div><strong>Payment:</strong> ${escapeHtml(filterLabel)}</div>
    ${search.trim() ? `<div><strong>Customer search:</strong> ${escapeHtml(search.trim())}</div>` : ''}
    <div><strong>Transactions:</strong> ${activeRows.length}</div>
  </div>

  <div class="stats">
    <div class="stat"><span>Selected Sales</span><strong>${escapeHtml(peso(sales))}</strong></div>
    <div class="stat"><span>Cash</span><strong>${escapeHtml(peso(cash))}</strong></div>
    <div class="stat"><span>GCash</span><strong>${escapeHtml(peso(gcash))}</strong></div>
    <div class="stat"><span>Pay Later</span><strong>${escapeHtml(peso(payLater))}</strong></div>
  </div>

  ${
    activeRows.length === 0
      ? '<div class="empty">No transactions match the selected filters.</div>'
      : `<table>
          <thead>
            <tr>
              <th>Transaction ID</th><th>Date</th><th>Customer</th><th>Phone</th><th>Service</th>
              <th>Kg</th><th>Loads</th><th>Add-ons</th><th>Total</th><th>Payment</th><th>GCash Ref</th><th>Pickup</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>`
  }

  <div class="footer">${escapeHtml(reportFooter || 'Generated from Aquaspin Laundry Station. Deleted transactions are excluded from this report.')}</div>
  <script>
    window.addEventListener('load', () => {
      setTimeout(() => window.print(), 250)
    })
  </script>
</body>
</html>`)
  reportWindow.document.close()
}
