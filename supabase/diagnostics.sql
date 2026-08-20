-- ============================================================
-- Диагностика на базата — САМО ЧЕТЕНЕ, нищо не променя
-- ============================================================
-- Пуска се в Supabase SQL Editor (първо на prod — там са реалните обеми).
-- Всяка секция е самостоятелна: маркирай я и я пусни, за да видиш резултата
-- отделно.
-- ============================================================

-- ---- 1. Кои таблици колко тежат ---------------------------------------
-- Показва къде реално са данните. Ако нещо неочаквано е най-голямо, там е и
-- първата работа по оптимизация.
select
  relname as таблица,
  n_live_tup as редове,
  pg_size_pretty(pg_total_relation_size(relid)) as общо,
  pg_size_pretty(pg_relation_size(relid)) as данни,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) as индекси
from pg_stat_user_tables
where schemaname = 'public'
order by pg_total_relation_size(relid) desc
limit 25;


-- ---- 2. Неизползвани индекси ------------------------------------------
-- Индекс, който никога не е ползван, само бави записа и заема място.
-- ВНИМАНИЕ: числата се трупат от последния рестарт на статистиката — ако
-- базата е рестартирана скоро, „0 ползвания" не значи непременно излишен.
select
  relname as таблица,
  indexrelname as индекс,
  idx_scan as ползвания,
  pg_size_pretty(pg_relation_size(indexrelid)) as размер
from pg_stat_user_indexes
where schemaname = 'public' and idx_scan < 50
order by pg_relation_size(indexrelid) desc
limit 25;


-- ---- 3. Дублирани индекси --------------------------------------------
-- Два индекса върху едни и същи колони в един и същ ред = единият е излишен.
select
  indrelid::regclass as таблица,
  array_agg(indexrelid::regclass) as дублирани,
  pg_size_pretty(sum(pg_relation_size(indexrelid))) as общо
from pg_index
where indrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
group by indrelid, indkey, indclass, indexprs, indpred
having count(*) > 1;


-- ---- 4. Липсващи индекси по чужди ключове -----------------------------
-- Външен ключ без индекс прави каскадните триения и join-овете бавни.
select
  c.conrelid::regclass as таблица,
  a.attname as колона
from pg_constraint c
join unnest(c.conkey) with ordinality k(attnum, ord) on true
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
where c.contype = 'f'
  and c.connamespace = 'public'::regnamespace
  and not exists (
    select 1 from pg_index i
    where i.indrelid = c.conrelid and i.indkey[0] = k.attnum
  )
order by 1, 2;


-- ---- 5. Секвенциални четения на цели таблици --------------------------
-- Голямо seq_scan при голяма таблица = заявка без индекс.
select
  relname as таблица,
  seq_scan as четения_на_цялата,
  idx_scan as четения_по_индекс,
  n_live_tup as редове
from pg_stat_user_tables
where schemaname = 'public' and n_live_tup > 500
order by seq_scan desc
limit 15;


-- ---- 6. Раздути таблици (мъртви редове) -------------------------------
-- Много мъртви редове = autovacuum не смогва; таблицата заема излишно място.
select
  relname as таблица,
  n_live_tup as живи,
  n_dead_tup as мъртви,
  case when n_live_tup > 0
       then round(100.0 * n_dead_tup / n_live_tup, 1) else 0 end as процент_мъртви,
  last_autovacuum
from pg_stat_user_tables
where schemaname = 'public' and n_dead_tup > 1000
order by n_dead_tup desc;


-- ---- 7. Най-бавните заявки --------------------------------------------
-- Изисква разширението pg_stat_statements (в Supabase е налично, но може да
-- не е включено — ако даде грешка, пропусни тази секция).
select
  round(mean_exec_time::numeric, 1) as средно_ms,
  calls as извиквания,
  round(total_exec_time::numeric / 1000, 1) as общо_сек,
  left(query, 120) as заявка
from pg_stat_statements
where query not ilike '%pg_stat%'
order by mean_exec_time desc
limit 15;
