import { useState, useRef, useEffect } from 'react'
import type { Tag } from '../../lib/types'
import { addTagToClient, removeTagFromClient, createTag } from '../../lib/storage'
import { useAuth } from '../../lib/auth'

const PRESET_COLORS = [
  '#EF4444', '#F59E0B', '#10B981', '#3B82F6',
  '#8B5CF6', '#EC4899', '#6B7280', '#F97316',
]

interface Props {
  clientId: string
  clientName: string
  assignedTags: Tag[]
  allTags: Tag[]
  onUpdate: () => void
}

export function TagEditor({ clientId, clientName, assignedTags, allTags, onUpdate }: Props) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(PRESET_COLORS[0])
  const [creating, setCreating] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const unassigned = allTags.filter(t => !assignedTags.some(at => at.id === t.id))
  const audit = { userId: user?.id, userName: user?.full_name ?? '', clientName }

  const handleAdd = async (tag: Tag) => {
    await addTagToClient(clientId, tag.id, { ...audit, tagName: tag.name })
    onUpdate()
  }

  const handleRemove = async (tag: Tag) => {
    await removeTagFromClient(clientId, tag.id, { ...audit, tagName: tag.name })
    onUpdate()
  }

  const handleCreate = async () => {
    if (!newTagName.trim()) return
    setCreating(true)
    try {
      const tag = await createTag(newTagName.trim(), newTagColor, { userId: user?.id, userName: user?.full_name ?? '' })
      await addTagToClient(clientId, tag.id, { ...audit, tagName: tag.name })
      setNewTagName('')
      onUpdate()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="relative" ref={popRef}>
      {/* Tag pills display */}
      <div
        className="flex flex-wrap gap-1 cursor-pointer min-h-[24px] px-1 rounded hover:bg-navy/5"
        onClick={() => setOpen(!open)}
      >
        {assignedTags.length === 0 && <span className="text-dark/20 text-xs">—</span>}
        {assignedTags.map(tag => (
          <span
            key={tag.id}
            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white leading-tight"
            style={{ backgroundColor: tag.color }}
          >
            {tag.name}
          </span>
        ))}
      </div>

      {/* Popover */}
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-light p-3">
          {/* Assigned tags */}
          {assignedTags.length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] text-dark/40 uppercase mb-1">Присвоени</p>
              <div className="flex flex-wrap gap-1">
                {assignedTags.map(tag => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemove(tag) }}
                      className="hover:opacity-70 text-[10px] leading-none"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Add existing */}
          {unassigned.length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] text-dark/40 uppercase mb-1">Добави</p>
              <div className="flex flex-wrap gap-1">
                {unassigned.map(tag => (
                  <button
                    key={tag.id}
                    onClick={() => handleAdd(tag)}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border border-current opacity-70 hover:opacity-100 transition"
                    style={{ color: tag.color }}
                  >
                    + {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Create new */}
          <div className="border-t border-light pt-2 mt-2">
            <p className="text-[10px] text-dark/40 uppercase mb-1">Нов таг</p>
            <div className="flex gap-1 mb-1.5">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setNewTagColor(c)}
                  className={`w-5 h-5 rounded-full border-2 transition ${newTagColor === c ? 'border-navy scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                placeholder="Име..."
                className="flex-1 px-2 py-1 text-xs border border-light rounded focus:outline-none focus:ring-1 focus:ring-navy"
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newTagName.trim()}
                className="px-2 py-1 text-xs bg-navy text-white rounded hover:bg-navy-light disabled:opacity-40 transition"
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
