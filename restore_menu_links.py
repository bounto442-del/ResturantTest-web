"""
Restore Supabase menu item categories/sauces/addons and link each item
to its matching Clover sandbox item by name.

Run with:
  python restore_menu_links.py
"""
import json
import urllib.request
import urllib.error

SUPABASE_URL = "https://wkohvggqwxowijbgdrbt.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indrb2h2Z2dxd3hvd2lqYmdkcmJ0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTIwODE4OSwiZXhwIjoyMDk2Nzg0MTg5fQ.yxIVAX1zibWTDz0n0M-wbns6R8YY4mPHqcxe1MZc67Y"
CLOVER_TOKEN = "9542cf99-f2fb-801b-3290-6442ad91b654"
CLOVER_MID = "077GSWKBQZAR1"
CLOVER_MERCHANT_UUID = "2cfea053-c6bc-41c2-92d9-f5f66c432bdb"


def supabase(method, path, body=None):
    url = f"{SUPABASE_URL}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", SUPABASE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            body_text = r.read().decode()
            return r.status, json.loads(body_text) if body_text else None
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        return e.code, json.loads(body_text) if body_text else None


def clover_api(method, path, body=None):
    url = f"https://apisandbox.dev.clover.com{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {CLOVER_TOKEN}")
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            body_text = r.read().decode()
            return r.status, json.loads(body_text) if body_text else None
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        return e.code, json.loads(body_text) if body_text else None


def split_columns(text):
    """Split a SQL row by commas at top level, respecting quoted strings and brackets."""
    parts = []
    current = ""
    depth_bracket = 0
    in_string = False
    string_char = None
    i = 0
    while i < len(text):
        ch = text[i]
        if not in_string and ch in ("'", '"'):
            in_string = True
            string_char = ch
            current += ch
            i += 1
            continue
        if in_string:
            current += ch
            if ch == string_char:
                # Postgres escaped quote is '' (two single quotes)
                if i + 1 < len(text) and text[i + 1] == string_char:
                    pass  # next char will be added too
                else:
                    in_string = False
                    string_char = None
            i += 1
            continue
        if ch in ("[", "{"):
            depth_bracket += 1
        elif ch in ("]", "}"):
            depth_bracket -= 1
        elif ch == "," and depth_bracket == 0:
            parts.append(current.strip())
            current = ""
            i += 1
            continue
        current += ch
        i += 1
    parts.append(current.strip())
    return parts


def unquote_sql(s):
    s = s.strip()
    if (s.startswith("'") and s.endswith("'")) or (s.startswith('"') and s.endswith('"')):
        s = s[1:-1]
    return s.replace("''", "'")


def parse_seed():
    rows = []
    with open("seed_menu_items.sql", "r", encoding="utf-8") as f:
        in_values = False
        for line in f:
            stripped = line.strip()
            if "INSERT INTO public.menu_items" in stripped:
                in_values = True
                continue
            if not in_values:
                continue
            if not stripped.startswith("("):
                continue
            # Strip trailing comma/semicolon and closing paren
            row_text = stripped.rstrip(";,").rstrip()
            if row_text.endswith(")"):
                row_text = row_text[1:-1]
            else:
                continue
            cols = split_columns(row_text)
            if len(cols) < 13:
                continue
            rows.append({
                "name": unquote_sql(cols[1]),
                "category": unquote_sql(cols[4]),
                "sauces": unquote_sql(cols[10]),
                "addons": unquote_sql(cols[11]),
            })
    return {r["name"]: r for r in rows}


def normalize_name(name):
    try:
        # Some Supabase rows may have double-encoded UTF-8
        name = name.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return name.strip()


def main():
    seed_by_name = parse_seed()
    print(f"Parsed {len(seed_by_name)} seed items")

    status, sb_items = supabase("GET", "/rest/v1/menu_items?select=*&limit=100")
    if status != 200:
        print("Failed to load Supabase items:", status, sb_items)
        return
    print(f"Loaded {len(sb_items)} Supabase items")

    status, clover_res = clover_api("GET", f"/v3/merchants/{CLOVER_MID}/items?limit=100")
    if status != 200:
        print("Failed to load Clover items:", status, clover_res)
        return
    clover_items = clover_res.get("elements", [])
    print(f"Loaded {len(clover_items)} Clover items")

    clover_by_name = {normalize_name(i["name"]): i for i in clover_items}

    updated = 0
    skipped = 0
    for item in sb_items:
        name = normalize_name(item["name"])
        seed = seed_by_name.get(name)
        clover_item = clover_by_name.get(name)
        if not seed:
            print(f"No seed data for: {name}")
            skipped += 1
            continue
        if not clover_item:
            print(f"No Clover match for: {name}")
            skipped += 1
            continue

        patch = {
            "merchant_id": CLOVER_MERCHANT_UUID,
            "clover_item_id": clover_item["id"],
            "category": seed["category"],
            "sauces": seed["sauces"],
            "addons": seed["addons"],
        }
        status, res = supabase(
            "PATCH",
            f"/rest/v1/menu_items?id=eq.{item['id']}",
            patch,
        )
        if status in (200, 204):
            updated += 1
            print(f"Updated: {name} -> {clover_item['id']}")
        else:
            print(f"Failed to update {name}: {status} {res}")
            skipped += 1

    print(f"\nDone. Updated {updated}, skipped {skipped}")


if __name__ == "__main__":
    main()
