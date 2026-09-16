import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode; onClose: () => void }
type State = { error: Error | null }

export default class ActionErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Transaction action failed to render', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-red-300 bg-white p-5 shadow-xl dark:border-red-900 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">!</div>
              <div>
                <h2 className="font-semibold text-red-700 dark:text-red-400">This action couldn't open</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Aquaspin is still running and no transaction was changed. Close this message, refresh the list if needed, then try again.
                </p>
              </div>
            </div>

            <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800">
              <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">Technical details</summary>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-red-700 dark:text-red-300">{this.state.error.message || 'Unknown browser error'}</pre>
            </details>

            <div className="mt-4 flex justify-end">
              <button type="button" onClick={this.props.onClose} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900">Close &amp; try again</button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
