import { Component, type ReactNode } from 'react'
import { t } from '../lib/i18n'

interface Props { children: ReactNode; fallback?: (reset: () => void, error: Error) => ReactNode; onError?: (e: Error) => void }
interface State { error: Error | null }

/** Catches render errors so one broken view never blanks the whole app. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error) { console.error(error); this.props.onError?.(error) }
  reset = () => this.setState({ error: null })
  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) return this.props.fallback(this.reset, this.state.error)
    return (
      <div className="h-full w-full flex items-center justify-center p-6 text-center">
        <div className="max-w-md">
          <div className="text-4xl mb-3">😵</div>
          <h2 className="text-lg font-bold">{t('Something went wrong')}</h2>
          <p className="text-sm text-text-2 mt-1 break-words">{this.state.error.message}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button className="btn-ghost" onClick={this.reset}>{t('Try again')}</button>
            <button className="btn-primary" onClick={() => location.reload()}>{t('Reload')}</button>
          </div>
        </div>
      </div>
    )
  }
}
