-- ============================================================
-- Диагностика на базата — САМО ЧЕТЕНЕ, нищо не променя
-- ============================================================
-- Пуска се в Supabase SQL Editor (първо на prod — там са реалните обеми).
-- Всяка секция е самостоятелна: маркирай я и я пусни, за да видиш резултата
-- отделно.
-- ============================================================

-- ---- 1. Кои таблици колко тежат ---------------------------------------
-- Показва къде реално са данните.
--
-- ВНИМАНИЕ: НЕ ползвай pg_stat_user_tables.n_live_tup за „брой редове" — това
-- е ОЦЕНКА, която се поддържа от autovacuum/ANALYZE. След нулиране на
-- статистиката (или restore) тя пада до 0 и се оправя чак при следващия
-- autovacuum. Реален случай: crm_staff с 16 записа показваше 3.
-- Затова тук се брои наистина, през query_to_xml — базата е малка и това е
-- евтино, а числото е вярно.
--
-- „индекси" идва от pg_indexes_size(). Разликата общо − данни НЕ е това: тя
-- включва и TOAST — отделното място за дългите текстове (body на шаблоните,
-- metadata на audit log-а). Слети в една колона, таблица с 3 реда изглежда
-- все едно има 200 kB индекси.
select
  relname as таблица,
  (xpath(
    '/row/c/text()',
    query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname), false, true, '')
  ))[1]::text::bigint as редове,
  pg_size_pretty(pg_total_relation_size(relid)) as общо,
  pg_size_pretty(pg_relation_size(relid)) as данни,
  pg_size_pretty(pg_indexes_size(relid)) as индекси,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid) - pg_indexes_size(relid)) as дълги_текстове
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
-- Прагът е по РЕАЛЕН брой редове, не по n_live_tup (виж бележката в секция 1
-- защо оценката не става за филтър — таблица можеше да изпадне от списъка
-- само защото статистиката ѝ е стара).
select
  relname as таблица,
  seq_scan as четения_на_цялата,
  idx_scan as четения_по_индекс,
  (xpath(
    '/row/c/text()',
    query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname), false, true, '')
  ))[1]::text::bigint as редове
from pg_stat_user_tables
where schemaname = 'public'
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


-- ---- 7. Кои заявки НА ПРИЛОЖЕНИЕТО тежат най-много ---------------------
-- Изисква pg_stat_statements (в Supabase е налично; ако даде грешка —
-- пропусни секцията).
--
-- Сортира се по ОБЩО време, не по средно. Средното изкарва отгоре редки, но
-- бавни служебни заявки; реалната цена е брой × време. Филтърът оставя само
-- нашите таблици — иначе списъкът се пълни с интроспекция на самия Supabase
-- (Dashboard, PostgREST schema cache, realtime housekeeping, pg_timezone_names),
-- която не идва от кода ни и не можем да я променим.
select
  round(total_exec_time::numeric / 1000, 1) as общо_сек,
  calls as извиквания,
  round(mean_exec_time::numeric, 1) as средно_ms,
  round(max_exec_time::numeric, 1) as най_бавно_ms,
  left(query, 140) as заявка
from pg_stat_statements
where query ilike '%crm\_%' escape '\'
  and query not ilike '%pg_stat%'
order by total_exec_time desc
limit 20;


-- ---- 8. Общата картина: колко от времето изобщо е наше -----------------
-- Ако „приложение" е малка част от общото, тясното място не е в кода ни.
select
  case when query ilike '%crm\_%' escape '\' then 'приложение' else 'служебни/Supabase' end as вид,
  count(*) as различни_заявки,
  sum(calls) as извиквания,
  round(sum(total_exec_time)::numeric / 1000, 1) as общо_сек,
  round((100.0 * sum(total_exec_time) / nullif(sum(sum(total_exec_time)) over (), 0))::numeric, 1) as дял_процент
from pg_stat_statements
group by 1
order by общо_сек desc;
