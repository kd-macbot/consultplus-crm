import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import logoNavy from '../../assets/brand/logo-navy.png'
import logoWhite from '../../assets/brand/logo-white.png'
import { useAuth } from '../../lib/auth'

// Логото на Microsoft — четирите квадратчета, в официалните цветове.
// Inline SVG, защото lucide-react няма марки, а заради четири правоъгълника
// не си струва нова зависимост.
function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 23 23" className={className} aria-hidden="true">
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  )
}

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const { login, loginWithMicrosoft, user, authError, clearAuthError } = useAuth()
  const navigate = useNavigate()

  // Входът с Microsoft се връща на този адрес и профилът идва от
  // AuthProvider, не от submit-а тук — затова пренасочването е по `user`.
  // Важи и за входа с парола: един път, на едно място.
  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    clearAuthError()
    setSubmitting(true)
    const result = await login(email, password)
    setSubmitting(false)
    if (result.error) setError(result.error)
  }

  const handleMicrosoft = async () => {
    setError('')
    clearAuthError()
    setRedirecting(true)
    const result = await loginWithMicrosoft()
    // При успех браузърът вече излиза към Microsoft и този код не се
    // изпълнява; стигаме дотук само ако пренасочването се провали.
    if (result.error) setRedirecting(false)
  }

  // `error` е от формата, `authError` — от връщането от Microsoft или от
  // отказан профил. Второто надживява зареждането на страницата.
  const message = error || authError

  return (
    <div className="min-h-screen flex items-center justify-center bg-light">
      <div className="bg-card rounded-lg shadow-lg p-8 w-full max-w-md">
        <div className="text-center mb-8">
          {/* Navy логото за светъл фон; в тъмна тема — бялото. */}
          <img src={logoNavy} alt="Consult Plus" className="h-14 w-auto mx-auto dark:hidden" />
          <img src={logoWhite} alt="Consult Plus" className="h-14 w-auto mx-auto hidden dark:block" />
          <p className="text-dark/60 mt-3">360° поглед върху клиентите и екипа</p>
        </div>

        <button
          type="button"
          onClick={handleMicrosoft}
          disabled={redirecting || submitting}
          className="w-full py-2 px-4 border border-border rounded-md bg-card hover:bg-muted/60 transition font-medium flex items-center justify-center gap-2.5 disabled:opacity-50"
        >
          <MicrosoftLogo className="h-[18px] w-[18px]" />
          {redirecting ? 'Пренасочване...' : 'Вход с Microsoft'}
        </button>

        <div className="flex items-center gap-3 my-5">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-dark/50">или с парола</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Имейл</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-navy"
              placeholder="email@consultplus.bg"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dark mb-1">Парола</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-navy"
              placeholder="••••••"
              required
            />
          </div>

          {message && (
            <p className="text-red-600 text-sm">{message}</p>
          )}

          <button
            type="submit"
            disabled={submitting || redirecting}
            className="w-full py-2 px-4 bg-navy text-white rounded-md hover:bg-navy-light transition font-medium disabled:opacity-50"
          >
            {submitting ? 'Влизане...' : 'Вход'}
          </button>
        </form>
      </div>
    </div>
  )
}
