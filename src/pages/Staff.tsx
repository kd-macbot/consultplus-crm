import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { createStaffMember, updateStaffMember, setStaffActive } from '../lib/storage'
import { useAuth } from '../lib/auth'

interface StaffMember {
  id: string
  full_name: string
  position: string | null
  department: string | null
  email: string | null
  phone: string | null
  is_active: boolean
  created_at: string
}

const DEPARTMENTS = ['Счетоводство', 'ТРЗ', 'Управление', 'Друго']

export function StaffPage() {
  const { user } = useAuth()
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<StaffMember | null>(null)
  const [filterDept, setFilterDept] = useState('all')

  const isAdmin = user?.role === 'admin'

  useEffect(() => { loadStaff() }, [])

  async function loadStaff() {
    setLoading(true)
    const { data, error } = await supabase
      .from('crm_staff')
      .select('*')
      .order('full_name')
    if (!error) setStaff(data ?? [])
    setLoading(false)
  }

  async function saveStaff(member: Partial<StaffMember>) {
    const audit = { userId: user?.id, userName: user?.full_name ?? '' }
    if (editing) {
      await updateStaffMember(editing.id, member, { ...audit, staffName: editing.full_name })
    } else {
      await createStaffMember(member, audit)
    }
    setShowForm(false)
    setEditing(null)
    await loadStaff()
  }

  async function toggleActive(id: string, current: boolean) {
    const member = staff.find(s => s.id === id)
    await setStaffActive(id, !current, {
      userId: user?.id,
      userName: user?.full_name ?? '',
      staffName: member?.full_name,
    })
    await loadStaff()
  }

  const filtered = filterDept === 'all' ? staff : staff.filter(s => s.department === filterDept)
  const active = filtered.filter(s => s.is_active)
  const inactive = filtered.filter(s => !s.is_active)

  if (loading) return <div className="p-6 text-dark/50">Зареждане...</div>

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-navy">👥 Персонал</h1>
        <div className="flex items-center gap-2">
          <select
            value={filterDept}
            onChange={e => setFilterDept(e.target.value)}
            className="px-2 md:px-3 py-1.5 md:py-2 border border-light rounded-md text-xs md:text-sm"
          >
            <option value="all">Всички отдели</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          {isAdmin && (
            <button
              onClick={() => { setEditing(null); setShowForm(true) }}
              className="px-3 md:px-4 py-1.5 md:py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-xs md:text-sm font-medium"
            >
              + Нов служител
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-navy">
          <p className="text-sm text-dark/50">Общо служители</p>
          <p className="text-2xl font-bold text-navy">{staff.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
          <p className="text-sm text-dark/50">Активни</p>
          <p className="text-2xl font-bold text-green-600">{staff.filter(s => s.is_active).length}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-gold">
          <p className="text-sm text-dark/50">Отдели</p>
          <p className="text-2xl font-bold text-gold">{new Set(staff.map(s => s.department).filter(Boolean)).size}</p>
        </div>
      </div>

      {/* Staff Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {active.map(member => (
          <StaffCard key={member.id} member={member} isAdmin={isAdmin}
            onEdit={() => { setEditing(member); setShowForm(true) }}
            onToggle={() => toggleActive(member.id, member.is_active)}
          />
        ))}
      </div>

      {inactive.length > 0 && (
        <>
          <h2 className="text-lg font-medium text-dark/40 mt-8 mb-4">Неактивни</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-60">
            {inactive.map(member => (
              <StaffCard key={member.id} member={member} isAdmin={isAdmin}
                onEdit={() => { setEditing(member); setShowForm(true) }}
                onToggle={() => toggleActive(member.id, member.is_active)}
              />
            ))}
          </div>
        </>
      )}

      {/* Form Modal */}
      {showForm && (
        <StaffForm
          member={editing}
          onSave={saveStaff}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function StaffCard({ member, isAdmin, onEdit, onToggle }: {
  member: StaffMember; isAdmin: boolean; onEdit: () => void; onToggle: () => void
}) {
  const deptColors: Record<string, string> = {
    'Счетоводство': 'bg-blue-100 text-blue-700',
    'ТРЗ': 'bg-green-100 text-green-700',
    'Управление': 'bg-purple-100 text-purple-700',
    'Друго': 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="bg-white rounded-lg shadow p-4 hover:shadow-md transition">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-semibold text-navy">{member.full_name}</h3>
          {member.position && <p className="text-sm text-dark/60">{member.position}</p>}
        </div>
        {member.department && (
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${deptColors[member.department] || deptColors['Друго']}`}>
            {member.department}
          </span>
        )}
      </div>
      {member.email && <p className="text-xs text-dark/40 mt-1">📧 {member.email}</p>}
      {member.phone && <p className="text-xs text-dark/40">📞 {member.phone}</p>}
      {isAdmin && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-light">
          <button onClick={onEdit} className="text-xs text-navy hover:underline">✏️ Редактирай</button>
          <button onClick={onToggle} className="text-xs text-dark/40 hover:text-dark">
            {member.is_active ? '⏸ Деактивирай' : '▶️ Активирай'}
          </button>
        </div>
      )}
    </div>
  )
}

function StaffForm({ member, onSave, onClose }: {
  member: StaffMember | null; onSave: (m: Partial<StaffMember>) => void; onClose: () => void
}) {
  const [name, setName] = useState(member?.full_name ?? '')
  const [position, setPosition] = useState(member?.position ?? '')
  const [department, setDepartment] = useState(member?.department ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [phone, setPhone] = useState(member?.phone ?? '')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-navy mb-4">
          {member ? 'Редактирай служител' : 'Нов служител'}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Име *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy" />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Позиция</label>
            <input type="text" value={position} onChange={e => setPosition(e.target.value)}
              placeholder="напр. Счетоводител, ТРЗ специалист..."
              className="w-full px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy" />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Отдел</label>
            <select value={department} onChange={e => setDepartment(e.target.value)}
              className="w-full px-3 py-2 border border-light rounded-md">
              <option value="">— Избери —</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-dark mb-1">Имейл</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy" />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark mb-1">Телефон</label>
              <input type="text" value={phone} onChange={e => setPhone(e.target.value)}
                className="w-full px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy" />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 border border-light rounded-md text-sm hover:bg-light transition">
            Отказ
          </button>
          <button
            onClick={() => {
              if (!name.trim()) return
              onSave({
                full_name: name.trim(),
                position: position.trim() || null,
                department: department || null,
                email: email.trim() || null,
                phone: phone.trim() || null,
              })
            }}
            className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm font-medium"
          >
            {member ? 'Запази' : 'Добави'}
          </button>
        </div>
      </div>
    </div>
  )
}
