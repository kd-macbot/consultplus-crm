import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="min-h-screen flex items-center justify-center bg-light p-6">
          <div className="bg-white rounded-lg shadow-lg max-w-lg w-full p-6">
            <h1 className="text-xl font-bold text-red-600 mb-2">Възникна грешка</h1>
            <p className="text-sm text-dark/70 mb-4">
              Приложението срещна неочаквана грешка. Моля, презаредете страницата или опитайте отново.
            </p>
            <pre className="bg-light rounded p-3 text-xs overflow-auto max-h-48 text-dark/60 mb-4">
              {this.state.error.message}
            </pre>
            <div className="flex gap-2">
              <button
                onClick={this.reset}
                className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm"
              >
                Опитай отново
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 border border-light rounded-md hover:bg-light transition text-sm"
              >
                Презареди страницата
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
