import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-page text-text p-4">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-danger-bg rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-danger-text" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
            <p className="text-text-secondary text-sm mb-4">
              An unexpected error occurred. Try reloading the page.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-accent text-white rounded-lg px-6 py-2 text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
