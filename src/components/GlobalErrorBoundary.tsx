import { Component, type ErrorInfo, type ReactNode } from 'react'

export default class GlobalErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Aquaspin app render failure', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="min-h-svh flex items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
        <section className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-sm dark:border-red-900 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-600 font-bold text-white">AQ</div>
            <div>
              <h1 className="font-semibold text-slate-900 dark:text-slate-100">Aquaspin hit an unexpected screen error</h1>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                No new action is being submitted from this screen. Reload Aquaspin to reconnect to the latest data.
              </p>
            </div>
          </div>

          <button type="button" onClick={() => window.location.reload()} className="mt-5 w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">
            Reload Aquaspin
          </button>

          <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800">
            <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">Technical details</summary>
            <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-red-700 dark:text-red-300">{this.state.error.message || 'Unknown browser error'}</pre>
          </details>
        </section>
      </main>
    )
  }
}
