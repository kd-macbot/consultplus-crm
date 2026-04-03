import { useState, useEffect } from 'react'
import { getColumns, addColumn, deleteColumn, getDropdownOptions, addDropdownOption, deleteDropdownOption, clearAll } from '../lib/storage'
import type { Column, ColumnType, DropdownOption } from '../lib/types'

export function AdminPage() {
  const [columns, setColumns] = useState<Column[]>([])
  const [loading, setLoading] = useState(true)
  const [newColName, setNewColName] = useState('')
  const [newColType, setNewColType] = useState<ColumnType>('text')
  const [editingDropdown, setEditingDropdown] = useState<string | null>(null)
  const [newOptValue, setNewOptValue] = useState('')
  const [dropdownOpts, setDropdownOpts] = useState<DropdownOption[]>([])

  useEffect(() => { loadColumns() }, [])

  useEffect(() => {
    if (editingDropdown) {
      getDropdownOptions(editingDropdown).then(setDropdownOpts)
    } else {
      setDropdownOpts([])
    }
  }, [editingDropdown])

  async function loadColumns() {
    setLoading(true)
    const cols = await getColumns()
    setColumns(cols)
    setLoading(false)
    if (editingDropdown) {
      const opts = await getDropdownOptions(editingDropdown)
      setDropdownOpts(opts)
    }
  }

  const handleAddColumn = async () => {
    if (!newColName.trim()) return
    await addColumn(newColName.trim(), newColType)
    setNewColName('')
    await loadColumns()
  }

  const handleDeleteColumn = async (id: string, name: string) => {
    if (confirm(`Изтриване на колона "${name}"? Всички данни в нея ще бъдат загубени.`)) {
      await deleteColumn(id)
      if (editingDropdown === id) setEditingDropdown(null)
      await loadColumns()
    }
  }

  const handleAddOption = async () => {
    if (!newOptValue.trim() || !editingDropdown) return
    await addDropdownOption(editingDropdown, newOptValue.trim())
    setNewOptValue('')
    const opts = await getDropdownOptions(editingDropdown)
    setDropdownOpts(opts)
  }

  const handleDeleteOption = async (id: string) => {
    await deleteDropdownOption(id)
    if (editingDropdown) {
      const opts = await getDropdownOptions(editingDropdown)
      setDropdownOpts(opts)
    }
  }

  const typeLabels: Record<ColumnType, string> = {
    text: 'Текст', number: 'Число', date: 'Дата',
    dropdown: 'Падащо меню', checkbox: 'Отметка', email: 'Имейл', phone: 'Телефон',
  }

  if (loading) return <div className="p-6 text-dark/50">Зареждане...</div>

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-navy mb-6">⚙️ Администрация</h1>

      {/* Column Management */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-medium text-navy mb-4">Управление на колони</h2>
        
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newColName}
            onChange={e => setNewColName(e.target.value)}
            placeholder="Име на колона"
            className="flex-1 px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy"
            onKeyDown={e => e.key === 'Enter' && handleAddColumn()}
          />
          <select
            value={newColType}
            onChange={e => setNewColType(e.target.value as ColumnType)}
            className="px-3 py-2 border border-light rounded-md"
          >
            {Object.entries(typeLabels).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
          <button onClick={handleAddColumn} className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm">
            + Добави
          </button>
        </div>

        <div className="space-y-2">
          {columns.map((col, i) => (
            <div key={col.id} className={`flex items-center gap-3 p-2 rounded ${editingDropdown === col.id ? 'bg-gold/10 ring-1 ring-gold' : 'hover:bg-light/50'}`}>
              <span className="w-6 text-xs text-dark/30">{i + 1}</span>
              <span className="flex-1 font-medium text-sm">{col.name}</span>
              <span className="text-xs text-dark/40 bg-light px-2 py-0.5 rounded">{typeLabels[col.type]}</span>
              {col.staff_department && (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">👤 {col.staff_department}</span>
              )}
              {col.type === 'dropdown' && !col.staff_department && (
                <button
                  onClick={() => setEditingDropdown(editingDropdown === col.id ? null : col.id)}
                  className="text-xs text-navy hover:underline"
                >
                  {editingDropdown === col.id ? 'Затвори' : 'Стойности'}
                </button>
              )}
              <button onClick={() => handleDeleteColumn(col.id, col.name)} className="text-red-400 hover:text-red-600 text-xs">
                Изтрий
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Dropdown Options Editor */}
      {editingDropdown && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-medium text-navy mb-4">
            Стойности за: {columns.find(c => c.id === editingDropdown)?.name}
          </h2>
          
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newOptValue}
              onChange={e => setNewOptValue(e.target.value)}
              placeholder="Нова стойност"
              className="flex-1 px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy"
              onKeyDown={e => e.key === 'Enter' && handleAddOption()}
            />
            <button onClick={handleAddOption} className="px-4 py-2 bg-gold text-white rounded-md hover:bg-gold-light transition text-sm">
              + Добави
            </button>
          </div>

          <div className="space-y-1">
            {dropdownOpts.map(opt => (
              <div key={opt.id} className="flex items-center gap-3 p-2 hover:bg-light/50 rounded">
                <span className="flex-1 text-sm">{opt.value}</span>
                <button
                  onClick={() => handleDeleteOption(opt.id)}
                  className="text-red-400 hover:text-red-600 text-xs"
                >
                  ✕
                </button>
              </div>
            ))}
            {dropdownOpts.length === 0 && (
              <p className="text-sm text-dark/30">Няма стойности</p>
            )}
          </div>
        </div>
      )}

      {/* Data Management */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-medium text-navy mb-4">Данни</h2>
        <button
          onClick={async () => {
            if (confirm('Изчистване на ВСИЧКИ данни? Тази операция е необратима.')) {
              await clearAll()
              window.location.reload()
            }
          }}
          className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition text-sm"
        >
          🔄 Нулиране на данните
        </button>
        <p className="text-xs text-dark/40 mt-2">Изтрива всички клиенти, колони и стойности</p>
      </div>
    </div>
  )
}
