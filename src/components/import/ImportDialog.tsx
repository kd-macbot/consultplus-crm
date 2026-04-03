import { useState, useRef, useCallback } from 'react'
import type { Column } from '../../lib/types'
import { getColumns } from '../../lib/storage'
import {
  parseFile, autoMapColumns, importRows,
  type ParsedSheet, type ColumnMapping, type ImportResult,
} from '../../lib/import'

interface Props {
  onClose: () => void
  onDone: () => void
  userId?: string
}

type Step = 'upload' | 'preview' | 'importing' | 'done'

export function ImportDialog({ onClose, onDone, userId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [columns, setColumns] = useState<Column[]>([])
  const [mappings, setMappings] = useState<ColumnMapping[]>([])
  const [duplicateAction, setDuplicateAction] = useState<'update' | 'skip'>('skip')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [progress, setProgress] = useState('')
  const [newOptionsPrompt, setNewOptionsPrompt] = useState<{ columnName: string; values: string[] }[] | null>(null)
  const [newOptionsResolve, setNewOptionsResolve] = useState<((v: boolean) => void) | null>(null)

  const handleFile = useCallback(async (file: File) => {
    setError(null)
    try {
      const [parsed, cols] = await Promise.all([parseFile(file), getColumns()])
      setSheet(parsed)
      setColumns(cols)
      setMappings(autoMapColumns(parsed.headers, cols))
      setStep('preview')
    } catch (err: any) {
      setError(err?.message ?? 'Грешка при четене на файла')
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const updateMapping = (excelIndex: number, columnId: string) => {
    setMappings(prev => prev.map(m =>
      m.excelIndex === excelIndex
        ? { ...m, crmColumn: columnId ? columns.find(c => c.id === columnId) ?? null : null }
        : m
    ))
  }

  const mappedCount = mappings.filter(m => m.crmColumn).length

  const handleImport = async () => {
    if (!sheet) return
    setStep('importing')
    setProgress('Импортиране...')

    try {
      const res = await importRows(
        sheet.rows,
        mappings,
        duplicateAction,
        async (opts) => {
          return new Promise<boolean>((resolve) => {
            setNewOptionsPrompt(opts)
            setNewOptionsResolve(() => resolve)
          })
        },
        userId,
      )
      setResult(res)
      setStep('done')
    } catch (err: any) {
      setError(err?.message ?? 'Грешка при импортиране')
      setStep('preview')
    }
  }

  const handleNewOptionsResponse = (confirmed: boolean) => {
    newOptionsResolve?.(confirmed)
    setNewOptionsPrompt(null)
    setNewOptionsResolve(null)
    if (!confirmed) {
      setStep('preview')
    }
  }

  // Which CRM column IDs are already mapped
  const usedColumnIds = new Set(mappings.filter(m => m.crmColumn).map(m => m.crmColumn!.id))

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-light flex items-center justify-between">
          <h2 className="text-lg font-bold text-navy">
            {step === 'upload' && 'Импорт на клиенти'}
            {step === 'preview' && 'Преглед и настройки'}
            {step === 'importing' && 'Импортиране...'}
            {step === 'done' && 'Резултат от импорта'}
          </h2>
          <button onClick={onClose} className="text-dark/40 hover:text-dark text-xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* ── Upload step ── */}
          {step === 'upload' && (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              className="border-2 border-dashed border-light rounded-lg p-12 text-center hover:border-navy transition cursor-pointer"
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
              />
              <div className="text-4xl mb-3">📁</div>
              <p className="text-dark/70 font-medium">Плъзнете файл тук или кликнете за избор</p>
              <p className="text-dark/40 text-sm mt-1">.xlsx, .xls или .csv</p>
            </div>
          )}

          {/* ── Preview step ── */}
          {step === 'preview' && sheet && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="flex gap-4 text-sm">
                <span className="bg-light px-3 py-1 rounded-md">
                  {sheet.rows.length} реда за импорт
                </span>
                <span className="bg-light px-3 py-1 rounded-md">
                  {mappedCount} от {sheet.headers.length} колони свързани
                </span>
              </div>

              {/* Column mapping */}
              <div>
                <h3 className="font-medium text-navy mb-2">Свързване на колони</h3>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {mappings.map(m => (
                    <div key={m.excelIndex} className="flex items-center gap-2 text-sm">
                      <span className="w-48 truncate text-dark/70" title={m.excelHeader}>
                        {m.excelHeader}
                      </span>
                      <span className="text-dark/30">&rarr;</span>
                      <select
                        value={m.crmColumn?.id ?? ''}
                        onChange={e => updateMapping(m.excelIndex, e.target.value)}
                        className="flex-1 px-2 py-1 border border-light rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy"
                      >
                        <option value="">— Пропусни —</option>
                        {columns.map(col => (
                          <option
                            key={col.id}
                            value={col.id}
                            disabled={usedColumnIds.has(col.id) && m.crmColumn?.id !== col.id}
                          >
                            {col.name} ({col.type})
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Duplicate handling */}
              <div>
                <h3 className="font-medium text-navy mb-2">При дублирани клиенти (по &quot;Фирма&quot;)</h3>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio" name="dup" value="skip" checked={duplicateAction === 'skip'}
                      onChange={() => setDuplicateAction('skip')}
                    />
                    Пропусни
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio" name="dup" value="update" checked={duplicateAction === 'update'}
                      onChange={() => setDuplicateAction('update')}
                    />
                    Обнови
                  </label>
                </div>
              </div>

              {/* Preview table */}
              <div>
                <h3 className="font-medium text-navy mb-2">Преглед (първите 10 реда)</h3>
                <div className="overflow-x-auto border border-light rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-navy text-white">
                      <tr>
                        <th className="px-2 py-1 text-left">#</th>
                        {mappings.filter(m => m.crmColumn).map(m => (
                          <th key={m.excelIndex} className="px-2 py-1 text-left whitespace-nowrap">
                            {m.crmColumn!.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.rows.slice(0, 10).map((row, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-light/50'}>
                          <td className="px-2 py-1 text-dark/40">{i + 1}</td>
                          {mappings.filter(m => m.crmColumn).map(m => (
                            <td key={m.excelIndex} className="px-2 py-1 max-w-[200px] truncate">
                              {row[m.excelIndex] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── Importing step ── */}
          {step === 'importing' && (
            <div className="text-center py-12">
              {newOptionsPrompt ? (
                <div className="text-left max-w-md mx-auto">
                  <h3 className="font-medium text-navy mb-3">Нови стойности за падащи менюта</h3>
                  <p className="text-sm text-dark/70 mb-3">
                    Следните стойности не съществуват и ще бъдат създадени:
                  </p>
                  <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
                    {newOptionsPrompt.map((item, i) => (
                      <div key={i} className="text-sm">
                        <span className="font-medium">{item.columnName}:</span>{' '}
                        <span className="text-dark/70">{item.values.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleNewOptionsResponse(true)}
                      className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm font-medium"
                    >
                      Създай и продължи
                    </button>
                    <button
                      onClick={() => handleNewOptionsResponse(false)}
                      className="px-4 py-2 border border-light rounded-md hover:bg-light transition text-sm"
                    >
                      Отказ
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="animate-spin inline-block w-8 h-8 border-4 border-navy border-t-transparent rounded-full mb-3" />
                  <p className="text-dark/70">{progress}</p>
                </>
              )}
            </div>
          )}

          {/* ── Done step ── */}
          {step === 'done' && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-700">{result.imported}</div>
                  <div className="text-sm text-green-600">Нови клиенти</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-blue-700">{result.updated}</div>
                  <div className="text-sm text-blue-600">Обновени</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-gray-700">{result.skipped}</div>
                  <div className="text-sm text-gray-600">Пропуснати</div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div>
                  <h3 className="font-medium text-red-600 mb-2">
                    Грешки ({result.errors.length})
                  </h3>
                  <div className="max-h-40 overflow-y-auto border border-red-200 rounded-md">
                    {result.errors.map((err, i) => (
                      <div key={i} className="px-3 py-1 text-sm text-red-700 border-b border-red-100 last:border-b-0">
                        Ред {err.row}: {err.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-light flex justify-end gap-2">
          {step === 'preview' && (
            <button
              onClick={handleImport}
              disabled={mappedCount === 0}
              className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm font-medium disabled:opacity-30"
            >
              Импортирай {sheet?.rows.length} реда
            </button>
          )}
          {step === 'done' && (
            <button
              onClick={() => { onDone(); onClose() }}
              className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm font-medium"
            >
              Готово
            </button>
          )}
          {step !== 'importing' && (
            <button
              onClick={onClose}
              className="px-4 py-2 border border-light rounded-md hover:bg-light transition text-sm"
            >
              {step === 'done' ? 'Затвори' : 'Отказ'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
