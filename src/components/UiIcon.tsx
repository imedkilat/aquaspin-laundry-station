import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'home'
  | 'plus'
  | 'orders'
  | 'customers'
  | 'dashboard'
  | 'profile'
  | 'inventory'
  | 'gift'
  | 'box'
  | 'alert'
  | 'refresh'
  | 'arrow-right'
  | 'search'
  | 'calendar'
  | 'money'
  | 'wash'
  | 'settings'
  | 'staff'
  | 'tag'
  | 'download'

const PATHS: Record<IconName, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-6h6v6" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  orders: <><path d="M6 4h12v16H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  customers: <><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20c.7-3.2 3.3-5 7.5-5s6.8 1.8 7.5 5" /></>,
  dashboard: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
  profile: <><circle cx="12" cy="8" r="3" /><path d="M5 20c.7-3.3 3-5 7-5s6.3 1.7 7 5" /></>,
  inventory: <><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="M4 7v10l8 4 8-4V7M12 11v10" /></>,
  gift: <><path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13" /><path d="M12 7H8.5A2.5 2.5 0 1 1 11 4.5L12 7ZM12 7h3.5A2.5 2.5 0 1 0 13 4.5L12 7Z" /></>,
  box: <><path d="m4 7 8-4 8 4v10l-8 4-8-4V7Z" /><path d="m4 7 8 4 8-4M12 11v10" /></>,
  alert: <><path d="M12 4 3.5 19h17L12 4Z" /><path d="M12 9v4M12 16v.5" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.7-3L3 11" /><path d="M3 5v6h6" /><path d="M4 13a8 8 0 0 0 14.7 3L21 13" /><path d="M21 19v-6h-6" /></>,
  'arrow-right': <><path d="M4 12h16" /><path d="m14 6 6 6-6 6" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  money: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M7 9h.01M17 15h.01" /></>,
  wash: <><path d="M4 5h16M6 9h12M5 13c1.7-1.2 3.3-1.2 5 0s3.3 1.2 5 0 3.3-1.2 5 0" /><path d="M6 5v14h12V5" /></>,
  settings: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="m19.4 15 .1.1 1.2 1.2-2.1 2.1-1.2-1.2-.1-.1a7.8 7.8 0 0 1-2 1.1v.2V20h-3v-1.6-.2a7.8 7.8 0 0 1-2-1.1l-.1.1-1.2 1.2-2.1-2.1 1.2-1.2.1-.1a7.8 7.8 0 0 1-1.1-2H6.9H5.3v-3h1.6.2a7.8 7.8 0 0 1 1.1-2l-.1-.1-1.2-1.2L9 4.6l1.2 1.2.1.1a7.8 7.8 0 0 1 2-1.1v-.2V3h3v1.6.2a7.8 7.8 0 0 1 2 1.1l.1-.1 1.2-1.2 2.1 2.1-1.2 1.2-.1.1a7.8 7.8 0 0 1 1.1 2h.2h1.6v3h-1.6-.2a7.8 7.8 0 0 1-1.1 2Z" /></>,
  staff: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.6-3 2.5-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><path d="M16 5.5a3 3 0 0 1 0 5.8M16 15.5c2.4.3 3.9 1.7 4.5 4.5" /></>,
  tag: <><path d="M4 5v6l9 9 7-7-9-9H4Z" /><circle cx="8" cy="8" r="1" /></>,
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5M4 20h16" /></>,
}

export default function UiIcon({ name, size = 20, strokeWidth = 1.9, ...props }: { name: IconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {PATHS[name]}
    </svg>
  )
}
