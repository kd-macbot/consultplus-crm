import { NEW_CLIENT_MONTHS } from '../../lib/utils'

/** Виртуален бадж „НОВ" — показва се първите NEW_CLIENT_MONTHS месеца. */
export function NewClientBadge() {
  return (
    <span
      title={`Нов клиент (първите ${NEW_CLIENT_MONTHS} месеца)`}
      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-700 border border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800"
    >
      НОВ
    </span>
  )
}
