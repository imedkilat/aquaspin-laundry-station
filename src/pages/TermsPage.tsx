import { Link } from 'react-router-dom'
import { SHOP_NAME } from '../lib/supabase'

export default function TermsPage() {
  return (
    <main className="min-h-svh bg-slate-100 px-4 py-10 text-slate-800 dark:bg-slate-950 dark:text-slate-200 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-10">
        <Link to="/login" className="text-sm font-medium text-sky-700 hover:underline dark:text-sky-300">← Back to sign in</Link>
        <p className="mt-8 text-xs font-semibold uppercase tracking-widest text-sky-700 dark:text-sky-300">{SHOP_NAME}</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">Terms &amp; Conditions</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Last updated: September 27, 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-7">
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Authorized use</h2>
            <p className="mt-2">Aquaspin is an internal shop operations tool. Use is limited to accounts created or authorized by the shop owner. Keep your sign-in credentials private and do not share them with another person.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Accurate records</h2>
            <p className="mt-2">Enter and maintain accurate customer, service, payment, inventory, and transaction information. Follow the shop’s operating procedures when recording or updating orders.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Acceptable use and access</h2>
            <p className="mt-2">Use the app only for authorized shop work. Do not attempt to bypass access controls, access another person’s account, or interfere with the app or its data. The shop owner may disable an account or remove access when appropriate.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Availability and changes</h2>
            <p className="mt-2">The app is provided for shop operations and may be unavailable or changed during maintenance or service interruptions. These terms may change; continued use after an update means you agree to follow the current terms.</p>
          </section>
        </div>

        <footer className="mt-10 border-t border-slate-200 pt-5 text-sm dark:border-slate-800">
          <Link to="/privacy" className="font-medium text-sky-700 hover:underline dark:text-sky-300">Privacy Policy</Link>
        </footer>
      </article>
    </main>
  )
}
