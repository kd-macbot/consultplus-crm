import { renderContractHtml } from './contract'
import logoNavy from '../assets/brand/logo-navy.png'

/**
 * Печат на договора.
 *
 * Отваря нов прозорец със самостоятелен документ вместо да печата текущата
 * страница — така print CSS-ът на договора не се бие с Tailwind, тъмната тема
 * и sidebar-а, а оформлението излиза еднакво независимо откъде е пуснат.
 *
 * Оттам колегата прави „Запази като PDF" от диалога за печат.
 *
 * ПОЛЕТАТА: @page margin е НУЛА нарочно. Браузърът рисува своя header/footer
 * (URL „about:blank", дата, номер на страница) вътре в margin-а на @page —
 * няма CSS начин да се изключат, но при нулев margin просто няма къде да се
 * появят. Затова полетата идват отдругаде:
 *   – ляво/дясно: padding на body (важи за всички страници);
 *   – горе/долу: <thead>/<tfoot> на обгръщащата таблица, които браузърът
 *     повтаря на всяка страница.
 * Бонус: логото стои в thead-а, тоест на всяка страница — точно както е в
 * header-а на оригиналния Word документ. Пълномощното обаче е документ на
 * КЛИЕНТА и се заверява нотариално — там лого няма (opts.logo = false).
 */

const PRINT_CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  /* Мерките идват от самия Word документ: Calibri 10pt, междуредие w:line=222
     (0.925 от единичното) и по 30 twips (1.5pt) преди и след абзац. Затова
     готовият PDF излиза със същия брой страници като оригинала, а не двойно. */
  body {
    font-family: Calibri, Carlito, "Segoe UI", system-ui, sans-serif;
    font-size: 10pt; line-height: 1.12; color: #111;
    margin: 0; padding: 0 17mm;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* Обгръщащата таблица носи повтарящите се горно и долно поле. */
  table.sheet { width: 100%; border-collapse: collapse; }
  table.sheet > thead > tr > td { padding: 0; }
  table.sheet > tfoot > tr > td { padding: 0; }
  .run-head { padding: 11mm 0 4mm; }
  /* Без лого горното поле остава същото — само че празно. */
  .run-head:empty { padding: 15mm 0 0; }
  .run-foot { height: 9mm; }
  .logo { display: block; height: 26px; width: auto; }
  /* Самостоятелно заглавие („ПЪЛНОМОЩНО") диша; когато под него има
     подзаглавие (договорите), двете стоят слепени като едно цяло. */
  h1 { font-size: 15pt; text-align: center; margin: 0 0 11pt; letter-spacing: .5pt; }
  h1:has(+ h2) { margin-bottom: 2pt; }
  h2 { font-size: 10.5pt; font-weight: 600; text-align: center; margin: 0 0 11pt; color: #333; }
  /* Празен ред от шаблона (маркер „~"). */
  p.spacer { margin: 0; height: 8pt; }
  h3 {
    font-size: 10pt; margin: 10pt 0 3pt; padding-bottom: 2pt;
    border-bottom: .75pt solid #d4d4d4; page-break-after: avoid; break-after: avoid;
  }
  p { margin: 0 0 3pt; text-align: justify; orphans: 2; widows: 2; }
  ul { margin: 0 0 3pt; padding-left: 14pt; }
  li { margin-bottom: 1.5pt; text-align: justify; }
  /* Подписите не бива да се откъсват на самостоятелна страница. */
  p:last-child, p:nth-last-child(2), p:nth-last-child(3), p:nth-last-child(4) {
    page-break-inside: avoid; break-inside: avoid;
  }

  /* ---- Двуезичен договор: две равни колони BG | EN, както в Word-а ---- */
  table.bi { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.bi td {
    width: 50%; vertical-align: top; padding: 0 6pt 4pt 0;
  }
  table.bi td:last-child { padding-right: 0; padding-left: 6pt; }
  /* Заглавният ред (I. Раздел…) да не увисва сам в дъното на страницата. */
  table.bi tr:has(h3) { page-break-inside: avoid; break-inside: avoid; }
  table.bi h3 { margin-top: 8pt; }
  /* Първият ред е самото заглавие на договора — центрирано в двете колони. */
  table.bi tbody:first-child tr:first-child h1 { margin-top: 0; }

  /* ---- Неделими секции (маркер „===" в шаблона) ---------------------- */
  /* Контактите с банковата сметка и подписите не бива да се разкъсват през
     страници — ако не се събират, слизат цели на следващата. */
  table.bi > tbody.keep, .keep { page-break-inside: avoid; break-inside: avoid; }
  table.bi > tbody.keep > tr:first-child > td { padding-top: 6mm; }
  .keep { margin-top: 6mm; }
`

export function printContract(opts: { title: string; body: string; logo?: boolean }): boolean {
  const win = window.open('', '_blank')
  if (!win) return false  // блокиран popup — извикващият показва съобщение

  // Логото е bundled asset — при document.write относителните пътища се
  // резолвват спрямо about:blank, затова го подаваме абсолютно.
  const logoUrl = new URL(logoNavy, window.location.href).href

  const esc = (s: string) => s.replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

  win.document.write(`<!doctype html>
<html lang="bg"><head><meta charset="utf-8">
<title>${esc(opts.title)}</title>
<style>${PRINT_CSS}</style>
</head><body>
<table class="sheet">
<thead><tr><td><div class="run-head">${opts.logo === false ? '' : `<img class="logo" src="${esc(logoUrl)}" alt="Консулт Плюс">`}</div></td></tr></thead>
<tfoot><tr><td><div class="run-foot"></div></td></tr></tfoot>
<tbody><tr><td>
${renderContractHtml(opts.body)}
</td></tr></tbody>
</table>
</body></html>`)
  win.document.close()

  // Изчакваме логото, иначе печатът тръгва с празно място на негово място.
  const start = () => { win.focus(); win.print() }
  if (win.document.readyState === 'complete') start()
  else win.addEventListener('load', start)
  return true
}
