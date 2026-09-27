import { Link } from 'react-router-dom'
import { SHOP_NAME } from '../lib/supabase'

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-svh bg-slate-100 px-4 py-10 text-slate-800 dark:bg-slate-950 dark:text-slate-200 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-10">
        <Link to="/login" className="text-sm font-medium text-sky-700 hover:underline dark:text-sky-300">← Back to sign in</Link>
        <p className="mt-8 text-xs font-semibold uppercase tracking-widest text-sky-700 dark:text-sky-300">{SHOP_NAME}</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Last updated: September 27, 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-7">
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Information in Aquaspin</h2>
            <p className="mt-2">Aquaspin is an internal tool for running the laundry shop. It may store customer names, contact details and order history; staff account details; profile photos and shop logo images uploaded through the app; and anonymous usage analytics if a visitor accepts analytics.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">How information is used</h2>
            <p className="mt-2">Information is used for internal shop operations, such as recording and managing laundry transactions, contacting customers about their orders, managing staff access, and displaying shop branding. We do not sell or share customer or staff information for advertising or unrelated third-party use.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Access and storage</h2>
            <p className="mt-2">Customer and staff records are intended for authorized, signed-in staff and owners. Data is stored using Supabase services and transmitted over HTTPS. Shop logo images are branding assets and may be publicly served by the app; profile images are shown in signed-in account views.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Anonymous analytics</h2>
            <p className="mt-2">If you choose Accept, the app loads Vercel Web Analytics to collect anonymous, aggregated usage measurements such as page views and general device or browser information. It is not used for advertising. If you choose Decline, the analytics component is not loaded. You can clear the saved choice in your browser’s local storage to be asked again.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Questions</h2>
            <p className="mt-2">For questions about information in Aquaspin, contact the shop owner.</p>
          </section>
        </div>

        <footer className="mt-10 border-t border-slate-200 pt-5 text-sm dark:border-slate-800">
          <Link to="/terms" className="font-medium text-sky-700 hover:underline dark:text-sky-300">Terms &amp; Conditions</Link>
        </footer>
      </article>
    </main>
  )
}
