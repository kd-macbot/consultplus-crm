#!/usr/bin/env python3
"""Генерира SQL seed файл от crm_data.json — без мрежа.

Изходът се записва в supabase/_dev-seed.sql. Потребителят го пуска
ръчно в Supabase SQL Editor на dev проекта (както миграциите).

Цел: dev среда да получи реалистичен обем данни (~200 фирми, ~3-4k
клетки) за тест на performance, без локална Python инсталация.
"""
import json
import os
import uuid

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(SCRIPT_DIR, "..")
DATA_PATH = os.path.join(ROOT, "crm_data.json")
OUT_PATH = os.path.join(ROOT, "supabase", "_dev-seed.sql")

COLUMN_MAP = [
    {"header": "Фирма", "name": "Фирма", "type": "text", "required": True},
    {"header": "col_1", "name": "Оценка на клиент", "type": "dropdown", "required": False},
    {"header": "СТАТУС", "name": "Статус", "type": "dropdown", "required": False},
    {"header": "MAND", "name": "MAND", "type": "text", "required": False},
    {"header": "Счетоводител", "name": "Счетоводител", "type": "dropdown", "required": False},
    {"header": "Заместване", "name": "Заместване", "type": "dropdown", "required": False},
    {"header": "ТРЗ", "name": "ТРЗ", "type": "dropdown", "required": False},
    {"header": "ХОНОРАР", "name": "Хонорар", "type": "number", "required": False},
    {"header": "ТРЗ Отг.", "name": "ТРЗ Отг.", "type": "dropdown", "required": False},
    {"header": "ТРЗ Статус", "name": "ТРЗ Статус", "type": "dropdown", "required": False},
    {"header": "Данък изт./СИДО", "name": "Данък изт./СИДО", "type": "dropdown", "required": False},
    {"header": "col_11", "name": "Бележки", "type": "text", "required": False},
]


def q(s: str) -> str:
    """SQL escape за единични кавички."""
    return "'" + str(s).replace("'", "''") + "'"


def gen_uuid() -> str:
    return str(uuid.uuid4())


def main():
    with open(DATA_PATH, encoding="utf-8") as f:
        crm_data = json.load(f)
    rows = crm_data["Master"]["data"]
    print(f"Заредени {len(rows)} реда от JSON-а")

    out = []
    out.append("-- ============================================================")
    out.append("-- Dev seed — ~200 фирми с реалистични данни")
    out.append("-- ============================================================")
    out.append("-- Генериран автоматично от scripts/generate-dev-seed-sql.py.")
    out.append("-- НЕ редактирай ръчно. Пускай САМО на DEV проект (никога live!).")
    out.append("-- Идемпотентно: ако crm_columns не е празна, не прави нищо.")
    out.append("-- ============================================================")
    out.append("")
    out.append("DO $$")
    out.append("BEGIN")
    out.append("  IF (SELECT COUNT(*) FROM crm_columns) > 0 THEN")
    out.append("    RAISE NOTICE 'crm_columns не е празна — seed пропуснат.';")
    out.append("    RETURN;")
    out.append("  END IF;")
    out.append("END $$;")
    out.append("")
    out.append("-- Ако crm_columns е празна, продължава по-надолу. Ако не — горният")
    out.append("-- DO блок логва NOTICE, а долните INSERT-и ще паднат (с error).")
    out.append("-- Това е защита срещу случайно повторно пускане.")
    out.append("")

    # 1. Generate column UUIDs and INSERTs
    col_ids = {}
    out.append("-- ============= 1. crm_columns =============")
    for i, cm in enumerate(COLUMN_MAP):
        cid = gen_uuid()
        col_ids[cm["name"]] = cid
        required = "true" if cm["required"] else "false"
        out.append(
            f"INSERT INTO crm_columns (id, name, type, position, is_required) "
            f"VALUES ({q(cid)}, {q(cm['name'])}, {q(cm['type'])}, {i}, {required});"
        )
    out.append("")

    # 2. Generate dropdown options
    out.append("-- ============= 2. crm_dropdown_options =============")
    dropdown_cols = [cm for cm in COLUMN_MAP if cm["type"] == "dropdown"]
    opt_lookup = {}  # (col_name, value) -> opt_id
    total_opts = 0
    for dc in dropdown_cols:
        col_id = col_ids[dc["name"]]
        unique_vals = set()
        for row in rows:
            val = row.get(dc["header"])
            if val is not None and str(val).strip():
                unique_vals.add(str(val).strip())
        for i, val in enumerate(sorted(unique_vals)):
            opt_id = gen_uuid()
            opt_lookup[(dc["name"], val)] = opt_id
            out.append(
                f"INSERT INTO crm_dropdown_options (id, column_id, value, position) "
                f"VALUES ({q(opt_id)}, {q(col_id)}, {q(val)}, {i});"
            )
            total_opts += 1
    out.append("")

    # 3. Generate clients
    out.append("-- ============= 3. crm_clients =============")
    client_ids = []
    for _ in rows:
        cid = gen_uuid()
        client_ids.append(cid)
        out.append(
            f"INSERT INTO crm_clients (id, deleted) VALUES ({q(cid)}, false);"
        )
    out.append("")

    # 4. Generate cell_values
    out.append("-- ============= 4. crm_cell_values =============")
    cell_count = 0
    for ri, row in enumerate(rows):
        client_id = client_ids[ri]
        for cm in COLUMN_MAP:
            raw_val = row.get(cm["header"])
            if raw_val is None or str(raw_val).strip() == "":
                continue
            col_id = col_ids[cm["name"]]
            cell_id = gen_uuid()

            if cm["type"] == "number":
                try:
                    num = float(raw_val)
                except (ValueError, TypeError):
                    num = 0
                out.append(
                    f"INSERT INTO crm_cell_values (id, client_id, column_id, value_number) "
                    f"VALUES ({q(cell_id)}, {q(client_id)}, {q(col_id)}, {num});"
                )
            elif cm["type"] == "dropdown":
                opt_id = opt_lookup.get((cm["name"], str(raw_val).strip()))
                if not opt_id:
                    continue
                out.append(
                    f"INSERT INTO crm_cell_values (id, client_id, column_id, value_dropdown) "
                    f"VALUES ({q(cell_id)}, {q(client_id)}, {q(col_id)}, {q(opt_id)});"
                )
            else:
                out.append(
                    f"INSERT INTO crm_cell_values (id, client_id, column_id, value_text) "
                    f"VALUES ({q(cell_id)}, {q(client_id)}, {q(col_id)}, {q(str(raw_val).strip())});"
                )
            cell_count += 1
    out.append("")
    out.append(f"-- Total: {len(COLUMN_MAP)} columns, {total_opts} dropdown options, "
               f"{len(client_ids)} clients, {cell_count} cell values")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print(f"✅ Записан: {OUT_PATH}")
    print(f"   {len(COLUMN_MAP)} колони | {total_opts} dropdown стойности | "
          f"{len(client_ids)} клиенти | {cell_count} клетки")


if __name__ == "__main__":
    main()
