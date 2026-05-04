import { useState, useRef, useEffect } from 'react'
import type { Column, DropdownOption, CellValue } from '../../lib/types'
import { getDropdownOptions, setCellValue, getStaff, type StaffMember } from '../../lib/storage'
import { useAuth } from '../../lib/auth'

interface Props {
  column: Column
  clientId: string
  clientName: string
  cell?: CellValue
  oldDisplay: string
  onSave: () => void
  onCancel: () => void
}

export function CellEditor({ column, clientId, clientName, cell, oldDisplay, onSave, onCancel }: Props) {
  const { user } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const [value, setValue] = useState(() => {
    if (!cell) return ''
    if (column.type === 'number') return cell.value_number?.toString() ?? ''
    if (column.type === 'dropdown') return cell.value_dropdown ?? cell.value_text ?? ''
    if (column.type === 'checkbox') return cell.value_bool ? 'true' : 'false'
    if (column.type === 'date') return cell.value_date ?? ''
    return cell.value_text ?? ''
  })

  const [dropdownOpts, setDropdownOpts] = useState<DropdownOption[]>([])
  const [staffOpts, setStaffOpts] = useState<StaffMember[]>([])
  const isStaffLinked = !!column.staff_department

  useEffect(() => {
    if (column.type === 'dropdown') {
      if (isStaffLinked) {
        getStaff(column.staff_department!).then(setStaffOpts)
      } else {
        getDropdownOptions(column.id).then(setDropdownOpts)
      }
    }
    setTimeout(() => {
      inputRef.current?.focus()
      selectRef.current?.focus()
    }, 10)
  }, [column])

  const auditInfo = (newDisplay: string) => ({
    userId: user?.id,
    userName: user?.full_name ?? '',
    clientName,
    columnName: column.name,
    oldDisplay,
    newDisplay,
  })

  const save = async () => {
    try {
      const patch: Partial<CellValue> = {}
      let newDisplay = value
      if (column.type === 'number') {
        const num = value !== '' ? parseFloat(value) : NaN
        patch.value_number = !isNaN(num) ? num : null
        newDisplay = !isNaN(num) ? num.toString() : ''
      } else if (column.type === 'dropdown') {
        if (isStaffLinked) {
          patch.value_text = value || null
          patch.value_dropdown = null
          newDisplay = value
        } else {
          patch.value_dropdown = value || null
          const opt = dropdownOpts.find(d => d.id === value)
          newDisplay = opt?.value ?? ''
        }
      } else if (column.type === 'checkbox') {
        patch.value_bool = value === 'true'
        newDisplay = value === 'true' ? '✓' : ''
      } else if (column.type === 'date') {
        patch.value_date = value || null
        newDisplay = value
      } else {
        patch.value_text = value || null
        newDisplay = value
      }
      await setCellValue(clientId, column.id, patch, auditInfo(newDisplay))
      onSave()
    } catch (err) {
      console.error('Save error:', err)
      onCancel()
    }
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
        onChange={async e => {
          const v = e.target.checked ? 'true' : 'false'
          setValue(v)
          try {
            const newDisplay = e.target.checked ? '✓' : ''
            await setCellValue(clientId, column.id, { value_bool: e.target.checked }, auditInfo(newDisplay))
            onSave()
          } catch (err) {
            console.error('Checkbox save error:', err)
            onCancel()
          }
        }}
        className="w-4 h-4"
      />
    )
  }

  if (column.type === 'dropdown') {
    if (isStaffLinked) {
      return (
        <select
          ref={selectRef}
          value={value}
          onChange={async e => {
            const newVal = e.target.value
            setValue(newVal)
            try {
              await setCellValue(clientId, column.id, {
                value_text: newVal || null,
                value_dropdown: null,
              }, auditInfo(newVal))
              onSave()
            } catch (err) {
              console.error('Staff dropdown save error:', err)
              onCancel()
            }
          }}
          onKeyDown={handleKeyDown}
          className="w-full px-1 py-0.5 text-sm border border-navy rounded focus:outline-none"
        >
          <option value="">—</option>
          {staffOpts.map(s => (
            <option key={s.id} value={s.full_name}>{s.full_name}</option>
          ))}
        </select>
      )
    }

    return (
      <select
        ref={selectRef}
        value={value}
        onChange={async e => {
          const newVal = e.target.value
          setValue(newVal)
          try {
            const opt = dropdownOpts.find(d => d.id === newVal)
            await setCellValue(clientId, column.id, { value_dropdown: newVal || null }, auditInfo(opt?.value ?? ''))
            onSave()
          } catch (err) {
            console.error('Dropdown save error:', err)
            onCancel()
          }
        }}
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
      ref={inputRef}
      type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={handleKeyDown}
      className="w-full px-1 py-0.5 text-sm border border-navy rounded focus:outline-none"
    />
  )
}
