import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (login(email, password)) {
      navigate('/')
    } else {
      setError('Грешен имейл или парола')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-light">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-navy">Consult Plus</h1>
          <p className="text-dark/60 mt-2">Система за управление на клиенти</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Имейл</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy"
              placeholder="admin@consultplus.bg"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dark mb-1">Парола</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy"
              placeholder="••••••"
              required
            />
          </div>

          {error && (
            <p className="text-red-600 text-sm">{error}</p>
          )}

          <button
            type="submit"
            className="w-full py-2 px-4 bg-navy text-white rounded-md hover:bg-navy-light transition font-medium"
          >
            Вход
          </button>
        </form>

        <div className="mt-6 p-3 bg-light/50 rounded text-xs text-dark/50">
          <p className="font-medium mb-1">Демо акаунти:</p>
          <p>admin@consultplus.bg / admin123</p>
          <p>manager@consultplus.bg / manager123</p>
          <p>employee@consultplus.bg / employee123</p>
        </div>
      </div>
    </div>
  )
}
