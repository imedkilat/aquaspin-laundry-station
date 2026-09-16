import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  onClose: () => void
}

type State = {
  error: Error | null
}

export default class ActionErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the failure visible to the operator instead of blanking the SPA.
    // eslint-disable-next-line no-console
    console.error('Transaction action failed to render', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-red-300 bg-white p-5 shadow-xl dark:border-red-900 dark:bg-slate-900">
            <h2 className="font-semibold text-red-700 dark:text-red-400">Could not open transaction action</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              The rest of Aquaspin is still safe. Please copy or screenshot the message below.
            </p>
            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-300">
              {this.state.error.message || 'Unknown browser error'}
            </pre>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={this.props.onClose}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
