-- ============================================================
-- САМО ЧЕТЕ. Пусни СЛЕД миграция 064, първо на dev.
--
-- Показва на кого се променя отпуската, защото отпуска около
-- празник вече не яде празничния ден. Нищо не записва.
-- ============================================================

with approved as (
  select a.staff_id, a.start_date, a.end_date
  from crm_absences a
  where a.type = 'vacation' and a.status = 'approved'
),
-- разгъваме всяка отпуска по дни
days as (
  select ap.staff_id, d::date as day
  from approved ap, generate_series(ap.start_date, ap.end_date, interval '1 day') d
),
counted as (
  select
    d.staff_id,
    extract(year from d.day)::int as year,
    -- СТАРО: само Пн-Пт
    count(*) filter (where extract(isodow from d.day) between 1 and 5) as old_days,
    -- НОВО: Пн-Пт минус празниците, плюс обявените работни съботи
    count(*) filter (
      where (extract(isodow from d.day) between 1 and 5
             and not exists (select 1 from crm_holidays h
                             where h.date = d.day and h.is_working = false))
         or (extract(isodow from d.day) > 5
             and exists (select 1 from crm_holidays h
                         where h.date = d.day and h.is_working = true))
    ) as new_days
  from days d
  group by 1, 2
)
select
  s.full_name                    as "колега",
  c.year                         as "година",
  c.old_days                     as "използвани ДОСЕГА",
  c.new_days                     as "използвани СЛЕД промяната",
  c.old_days - c.new_days        as "връщат му се дни"
from counted c
join crm_staff s on s.id = c.staff_id
where c.old_days <> c.new_days
order by c.year desc, (c.old_days - c.new_days) desc, s.full_name;

-- Ако не върне нито един ред: никой не е ползвал отпуска около празник
-- и промяната не пипа нито едно число назад.
