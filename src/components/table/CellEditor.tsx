import { useState, useRef, useEffect } from 'react'
import type { Column, DropdownOption, CellValue } from '../../lib/types'
import { getDropdownOptions, setCellValue, getStaff, type StaffMember } from '../../lib/storage'

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
    setTimeout(() => inputRef.current?.focus(), 10)
  }, [column])

  const save = async () => {
    try {
      const patch: Partial<CellValue> = {}
      if (column.type === 'number') {
        patch.value_number = value ? Number(value) : null as any
      } else if (column.type === 'dropdown') {
        if (isStaffLinked) {
          // Staff-linked: save name as text
          patch.value_text = value || null as any
          patch.value_dropdown = null as any
        } else {
          patch.value_dropdown = value || null as any
        }
      } else if (column.type === 'checkbox') {
        patch.value_bool = value === 'true'
      } else if (column.type === 'date') {
        patch.value_date = value || null as any
      } else {
        patch.value_text = value || null as any
      }
      await setCellValue(clientId, column.id, patch)
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
            await setCellValue(clientId, column.id, { value_bool: e.target.checked })
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
          ref={inputRef as any}
          value={value}
          onChange={async e => {
            const newVal = e.target.value
            setValue(newVal)
            try {
              await setCellValue(clientId, column.id, {
                value_text: newVal || null as any,
                value_dropdown: null as any,
              })
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
        ref={inputRef as any}
        value={value}
        onChange={async e => {
          const newVal = e.target.value
          setValue(newVal)
          try {
            await setCellValue(clientId, column.id, { value_dropdown: newVal || null as any })
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
