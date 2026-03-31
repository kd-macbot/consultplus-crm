import { useState, useRef, useEffect } from 'react'
import type { Column, DropdownOption, CellValue } from '../../lib/types'
import { getDropdownOptions, setCellValue } from '../../lib/storage'

interface Props {
  column: Column
  clientId: string
  cell?: CellValue
  onSave: () => void
  onCancel: () => void
}

export function CellEditor({ column, clientId, cell, onSave, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)
  const [value, setValue] = useState(() => {
    if (!cell) return ''
    if (column.type === 'number') return cell.value_number?.toString() ?? ''
    if (column.type === 'dropdown') return cell.value_dropdown ?? ''
    if (column.type === 'checkbox') return cell.value_bool ? 'true' : 'false'
    if (column.type === 'date') return cell.value_date ?? ''
    return cell.value_text ?? ''
  })

  const [dropdownOpts, setDropdownOpts] = useState<DropdownOption[]>([])

  useEffect(() => {
    if (column.type === 'dropdown') {
      setDropdownOpts(getDropdownOptions(column.id))
    }
    setTimeout(() => inputRef.current?.focus(), 10)
  }, [column])

  const save = () => {
    const patch: Partial<CellValue> = {}
    if (column.type === 'number') {
      patch.value_number = value ? Number(value) : undefined
    } else if (column.type === 'dropdown') {
      patch.value_dropdown = value || undefined
    } else if (column.type === 'checkbox') {
      patch.value_bool = value === 'true'
    } else if (column.type === 'date') {
      patch.value_date = value || undefined
    } else {
      patch.value_text = value || undefined
    }
    setCellValue(clientId, column.id, patch)
    onSave()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') onCancel()
  }

  if (column.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={value === 'true'}
        onChange={e => {
          const v = e.target.checked ? 'true' : 'false'
          setValue(v)
          const patch: Partial<CellValue> = { value_bool: e.target.checked }
          setCellValue(clientId, column.id, patch)
          onSave()
        }}
        className="w-4 h-4"
      />
    )
  }

  if (column.type === 'dropdown') {
    return (
      <select
        ref={inputRef as any}
        value={value}
        onChange={e => { setValue(e.target.value); }}
        onBlur={save}
        onKeyDown={handleKeyDown}
        className="w-full px-1 py-0.5 text-sm border border-navy rounded focus:outline-none"
      >
        <option value="">—</option>
        {dropdownOpts.map(opt => (
          <option key={opt.id} value={opt.id}>{opt.value}</option>
        ))}
      </select>
    )
  }

  return (
    <input
      ref={inputRef as any}
      type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={handleKeyDown}
      className="w-full px-1 py-0.5 text-sm border border-navy rounded focus:outline-none"
    />
  )
}
