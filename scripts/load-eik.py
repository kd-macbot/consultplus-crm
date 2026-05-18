#!/usr/bin/env python3
"""
Bulk loader за ЕИК-та от regdata.apis.bg в crm_contacts.

Чете всички фирми от crm_clients (име = първата text колона),
търси по име в regdata, при намерен ЕИК прави upsert в crm_contacts.

Env vars:
  SUPABASE_URL              — задължителен
  SUPABASE_SERVICE_ROLE_KEY — задължителен (service role!)
  REGDATA_USERNAME          — задължителен
  REGDATA_PASSWORD          — задължителен
  REGDATA_PACKET_ID         — по подразбиране 1 (Стартов пакет)

Изход:
  load-eik-report.json — отчет: matched / multiple / not_found / errors
"""
import json
import os
import re
import sys
import time
from typing import Optional

try:
    import requests
    from supabase import create_client
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "requests", "supabase"])
    import requests
    from supabase import create_client


API_BASE = "https://regdata.apis.bg/api/v1"
LEGAL_FORMS = re.compile(r"\b(ЕООД|ООД|АД|ЕАД|СД|ЕТ|КД|КДА)\b", re.IGNORECASE)
# TextSearch sub-type "Заглавие" (от GET /data/nom/22)
TEXT_SUBTYPE_TITLE = "d5cf10b9"


def clean_name(name: str) -> str:
    return LEGAL_FORMS.sub("", re.sub(r"\s+", " ", name)).strip()


class RegData:
    def __init__(self, username: str, password: str):
        self.username = username
        self.password = password
        self.access_token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.expires_at: float = 0

    def _set_tokens(self, payload: dict):
        self.access_token = payload["accessToken"]
        self.refresh_token = payload["refreshToken"]
        self.expires_at = time.time() + int(payload["expireSeconds"]) - 60

    def _auth(self):
        body = {"refreshToken": self.refresh_token} if self.refresh_token else {
            "username": self.username, "password": self.password
        }
        r = requests.post(f"{API_BASE}/account/token", json=body, timeout=30)
        if r.status_code != 200 and self.refresh_token:
            # Refresh е изтекъл — пълна авторизация
            self.refresh_token = None
            return self._auth()
        r.raise_for_status()
        self._set_tokens(r.json())

    def _token(self) -> str:
        if not self.access_token or time.time() >= self.expires_at:
            self._auth()
        return self.access_token  # type: ignore

    def search(self, name: str, page_size: int = 10) -> list[dict]:
        body = {
            "condition": "AND",
            "rules": [
                {
                    "id": "TextSearch",
                    "operator": "in",
                    "value": [json.dumps({
                        "searchText": clean_name(name),
                        "searchFields": [TEXT_SUBTYPE_TITLE],
                    })],
                }
            ],
        }
        r = requests.post(
            f"{API_BASE}/data/search2/1/{page_size}",
            headers={"Authorization": f"Bearer {self._token()}"},
            json=body, timeout=30,
        )
        r.raise_for_status()
        return r.json().get("results", [])


def get_company_name_column_id(sb) -> str:
    res = sb.table("crm_columns").select("id").eq("type", "text").order("position").limit(1).execute()
    if not res.data:
        raise RuntimeError("Няма текстова колона в crm_columns")
    return res.data[0]["id"]


def get_clients_with_names(sb, name_col_id: str) -> list[dict]:
    cells = sb.table("crm_cell_values").select("client_id, value_text").eq("column_id", name_col_id).execute().data
    return [{"id": c["client_id"], "name": (c["value_text"] or "").strip()} for c in cells if c.get("value_text")]


def get_existing_contacts(sb) -> dict[str, dict]:
    rows = sb.table("crm_contacts").select("id, client_id, eik").execute().data
    return {r["client_id"]: r for r in rows}


def upsert_eik(sb, client_id: str, eik: str, existing: Optional[dict]):
    if existing:
        sb.table("crm_contacts").update({"eik": eik}).eq("id", existing["id"]).execute()
    else:
        sb.table("crm_contacts").insert({"client_id": client_id, "eik": eik}).execute()


def main():
    sb_url = os.environ["SUPABASE_URL"]
    sb_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    username = os.environ["REGDATA_USERNAME"]
    password = os.environ["REGDATA_PASSWORD"]

    sb = create_client(sb_url, sb_key)
    rd = RegData(username, password)

    name_col = get_company_name_column_id(sb)
    clients = get_clients_with_names(sb, name_col)
    existing = get_existing_contacts(sb)

    todo = [c for c in clients if not (existing.get(c["id"]) and existing[c["id"]].get("eik"))]
    print(f"Общо клиенти: {len(clients)}, за обработка (без ЕИК): {len(todo)}")

    report = {"matched": [], "multiple": [], "not_found": [], "errors": []}

    for i, client in enumerate(todo, 1):
        name = client["name"]
        try:
            results = rd.search(name)
        except Exception as e:
            print(f"[{i}/{len(todo)}] ✗ {name} — {e}")
            report["errors"].append({"name": name, "error": str(e)})
            continue

        active = [r for r in results if r.get("activity") == 1] or results

        if not active:
            print(f"[{i}/{len(todo)}] ∅ {name}")
            report["not_found"].append({"name": name})
            continue

        if len(active) > 1:
            print(f"[{i}/{len(todo)}] ? {name} → {len(active)} съвпадения")
            report["multiple"].append({
                "name": name,
                "client_id": client["id"],
                "candidates": [{"eik": r["identifier"], "caption": r["caption"]} for r in active[:5]],
            })
            continue

        best = active[0]
        eik = best["identifier"]
        try:
            upsert_eik(sb, client["id"], eik, existing.get(client["id"]))
            print(f"[{i}/{len(todo)}] ✓ {name} → {eik}  ({best['caption']})")
            report["matched"].append({"name": name, "eik": eik, "caption": best["caption"]})
        except Exception as e:
            print(f"[{i}/{len(todo)}] ✗ {name} → upsert грешка: {e}")
            report["errors"].append({"name": name, "error": str(e)})

        time.sleep(0.1)  # лек throttle

    with open("load-eik-report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print()
    print(f"✓ Записани:   {len(report['matched'])}")
    print(f"? Множествени: {len(report['multiple'])}  → виж load-eik-report.json")
    print(f"∅ Ненамерени:  {len(report['not_found'])}")
    print(f"✗ Грешки:      {len(report['errors'])}")


if __name__ == "__main__":
    main()
