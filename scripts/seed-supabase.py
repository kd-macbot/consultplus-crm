#!/usr/bin/env python3
"""Seed CRM data into Supabase from crm_data.json"""
import json
import sys
import os

try:
    from supabase import create_client
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "supabase", "-q"])
    from supabase import create_client

SB_URL = "https://shzmbcyctmuojpwaiagx.supabase.co"
SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoem1iY3ljdG11b2pwd2FpYWd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTA3MzY0OSwiZXhwIjoyMDkwNjQ5NjQ5fQ.Qzxt_PwG1Rlmw60RTQzav6bZCqrGVPrPOUnvoKJSGYI"

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

def main():
    sb = create_client(SB_URL, SB_KEY)
    
    # Check if already seeded
    res = sb.table("crm_columns").select("id", count="exact").execute()
    if len(res.data) > 0:
        print(f"Already seeded ({len(res.data)} columns). Skipping.")
        return

    # Load data
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_path = os.path.join(script_dir, "..", "crm_data.json")
    with open(data_path) as f:
        crm_data = json.load(f)
    rows = crm_data["Master"]["data"]
    print(f"Loaded {len(rows)} rows from Excel")

    # 1. Create columns
    col_inserts = [
        {"name": cm["name"], "type": cm["type"], "position": i, "is_required": cm["required"]}
        for i, cm in enumerate(COLUMN_MAP)
    ]
    res = sb.table("crm_columns").insert(col_inserts).execute()
    columns = res.data
    print(f"Created {len(columns)} columns")

    # 2. Create dropdown options
    dropdown_cols = [cm for cm in COLUMN_MAP if cm["type"] == "dropdown"]
    all_dropdowns = []
    for dc in dropdown_cols:
        col = next(c for c in columns if c["name"] == dc["name"])
        unique_vals = set()
        for row in rows:
            val = row.get(dc["header"])
            if val is not None and str(val).strip():
                unique_vals.add(str(val).strip())
        for i, val in enumerate(sorted(unique_vals)):
            all_dropdowns.append({"column_id": col["id"], "value": val, "position": i})

    inserted_dropdowns = []
    BATCH = 50
    for i in range(0, len(all_dropdowns), BATCH):
        batch = all_dropdowns[i:i+BATCH]
        res = sb.table("crm_dropdown_options").insert(batch).execute()
        inserted_dropdowns.extend(res.data)
    print(f"Created {len(inserted_dropdowns)} dropdown options")

    # 3. Create clients
    all_clients = []
    for i in range(0, len(rows), BATCH):
        count = min(BATCH, len(rows) - i)
        batch = [{"deleted": False} for _ in range(count)]
        res = sb.table("crm_clients").insert(batch).execute()
        all_clients.extend(res.data)
    print(f"Created {len(all_clients)} clients")

    # 4. Create cell values
    cell_inserts = []
    for ri, row in enumerate(rows):
        client_id = all_clients[ri]["id"]
        for cm in COLUMN_MAP:
            col = next(c for c in columns if c["name"] == cm["name"])
            raw_val = row.get(cm["header"])
            if raw_val is None or str(raw_val).strip() == "":
                continue
            
            cell = {"client_id": client_id, "column_id": col["id"]}
            if cm["type"] == "number":
                try:
                    cell["value_number"] = float(raw_val)
                except (ValueError, TypeError):
                    cell["value_number"] = 0
            elif cm["type"] == "dropdown":
                opt = next(
                    (d for d in inserted_dropdowns
                     if d["column_id"] == col["id"] and d["value"] == str(raw_val).strip()),
                    None
                )
                if opt:
                    cell["value_dropdown"] = opt["id"]
                else:
                    continue
            else:
                cell["value_text"] = str(raw_val).strip()
            
            cell_inserts.append(cell)

    for i in range(0, len(cell_inserts), BATCH):
        batch = cell_inserts[i:i+BATCH]
        sb.table("crm_cell_values").insert(batch).execute()
        if (i // BATCH) % 10 == 0:
            print(f"  Cells: {i+len(batch)}/{len(cell_inserts)}")
    
    print(f"Created {len(cell_inserts)} cell values")
    print("✅ Seed complete!")

if __name__ == "__main__":
    main()
