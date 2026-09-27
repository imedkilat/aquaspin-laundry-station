import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-bold uppercase tracking-widest text-sky-700 dark:text-sky-300">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">That page does not exist or may have moved.</p>
        <Link to="/" className="mt-6 inline-flex items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700">Back to home</Link>
      </section>
    </main>
  )
}
