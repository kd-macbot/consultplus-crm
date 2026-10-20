import { Component, type ReactNode } from 'react'
import { captureError, flushMonitoring } from '../lib/monitoring'
import { isChunkLoadError } from '../lib/chunkError'
import { attemptAutoReload } from '../lib/recovery'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
  /** Провален динамичен импорт — лекува се с презареждане, не е бъг в кода. */
  stale: boolean
  /** Презареждането тръгна ли, или guard-ът го спря. */
  reloading: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stale: false, reloading: false }

  static getDerivedStateFromError(error: Error): State {
    // `reloading` тръгва вярно при стара версия: презареждането ЩЕ бъде
    // поискано в componentDidCatch. Иначе екранът за миг щеше да покаже
    // „натисни бутона", а веднага след това да се презареди сам.
    const stale = isChunkLoadError(error)
    return { error, stale, reloading: stale }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
    // Уловената грешка не стига до window.onerror — React я е спрял тук.
    // Без това изрично докладване екранът „Възникна грешка" би останал
    // единствената следа, при това само в конзолата на колегата.
    captureError(error, { componentStack: info.componentStack })

    // СТАРА ВЕРСИЯ В ОТВОРЕН ТАБ. Всичките страници са `lazy()`, а хостингът
    // сервира само текущия деплой — тоест след качване навигацията иска файл,
    // който вече го няма. Нищо не е счупено: свежият index.html сочи новите
    // имена. Затова се презарежда САМО, а не се показва грешка.
    // Докладва се ПРЕДИ презареждането — иначе следата се губи и втори път
    // няма да разберем колко често се случва.
    if (isChunkLoadError(error)) {
      // Изчаква се докладът. `captureError` само слага събитието на опашка,
      // а презареждане веднага след това го отрязва — тоест поправката щеше
      // да скрие собствената си статистика и нямаше да знаем колко често се
      // случва. Изчакването е с таван и не може да забие.
      void flushMonitoring().then(() => {
        // Guard-ът (max 4 презареждания за 5 мин) може да откаже. Тогава
        // екранът трябва да спре да обещава презареждане и да даде бутон.
        if (!attemptAutoReload('провален lazy chunk (нова версия)')) {
          this.setState({ reloading: false })
        }
      })
    }
  }

  reset = () => this.setState({ error: null, stale: false, reloading: false })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      // Два различни случая, два различни текста. „Failed to fetch
      // dynamically imported module: …" на английски не казва на колегата
      // нищо, а верният изход е просто презареждане.
      const { stale, reloading } = this.state
      return (
        <div className="min-h-screen flex items-center justify-center bg-light p-6">
          <div className="bg-card rounded-lg shadow-lg max-w-lg w-full p-6">
            {stale ? (
              <>
                <h1 className="text-xl font-bold text-navy mb-2">Излязла е нова версия</h1>
                <p className="text-sm text-dark/70 mb-4">
                  {reloading
                    ? 'Презареждам страницата…'
                    : 'Страницата трябва да се презареди, за да продължиш. Нищо записано не се губи.'}
                </p>
              </>
            ) : (
              <>
                <h1 className="text-xl font-bold text-red-600 mb-2">Възникна грешка</h1>
                <p className="text-sm text-dark/70 mb-4">
                  Приложението срещна неочаквана грешка. Моля, презаредете страницата или опитайте отново.
                </p>
                <pre className="bg-light rounded p-3 text-xs overflow-auto max-h-48 text-dark/60 mb-4">
                  {this.state.error.message}
                </pre>
              </>
            )}
            <div className="flex gap-2">
              {!stale && (
                <button
                  onClick={this.reset}
                  className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm"
                >
                  Опитай отново
                </button>
              )}
              <button
                onClick={() => window.location.reload()}
                className={stale
                  ? 'px-4 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm'
                  : 'px-4 py-2 border border-border rounded-md hover:bg-light transition text-sm'}
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
