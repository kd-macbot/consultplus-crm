import { renderContractHtml } from './contract'

/**
 * Сваляне на документа като файл за Word.
 *
 * Word отваря HTML със заглавка „application/msword" като редактируем документ
 * и при запис го превръща в истински .docx. Така пълномощното може да се
 * дооформи преди нотариус, без приложението да носи библиотека за OOXML
 * (~250KB) заради една функция.
 *
 * Компромисът: файлът е .doc (HTML вътре), не .docx. Word го отваря без
 * проблем; при „Запази като" избира .docx.
 */

const WORD_CSS = `
  @page { size: A4; margin: 20mm 17mm; }
  body { font-family: Calibri, sans-serif; font-size: 10pt; line-height: 1.12; color: #111; }
  h1 { font-size: 15pt; text-align: center; margin: 0 0 2pt; }
  h2 { font-size: 10.5pt; text-align: center; margin: 0 0 8pt; color: #333; }
  h3 { font-size: 10pt; margin: 10pt 0 3pt; }
  p { margin: 0 0 3pt; text-align: justify; }
  ul { margin: 0 0 3pt; padding-left: 14pt; }
  li { margin-bottom: 1.5pt; text-align: justify; }
  table.bi { width: 100%; border-collapse: collapse; }
  table.bi td { width: 50%; vertical-align: top; padding: 0 6pt 4pt 0; }
`

export function downloadAsWord(opts: { fileName: string; body: string }): void {
  const html = `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${opts.fileName}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>${WORD_CSS}</style>
</head><body>
${renderContractHtml(opts.body)}
</body></html>`

  // BOM-ът е задължителен — без него Word чете кирилицата като маймуница.
  const blob = new Blob(['﻿', html], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${opts.fileName}.doc`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
