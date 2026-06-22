"""
Create Clover modifier groups for each menu item's sauces/addons,
and attach those groups to the matching Clover item.
"""
import json
import urllib.request
import urllib.error

TOKEN = "9542cf99-f2fb-801b-3290-6442ad91b654"
MID = "077GSWKBQZAR1"
SUPABASE_URL = "https://wkohvggqwxowijbgdrbt.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indrb2h2Z2dxd3hvd2lqYmdkcmJ0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTIwODE4OSwiZXhwIjoyMDk2Nzg0MTg5fQ.yxIVAX1zibWTDz0n0M-wbns6R8YY4mPHqcxe1MZc67Y"


def clover(method, path, body=None):
    url = f"https://apisandbox.dev.clover.com{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            body_text = r.read().decode()
            return r.status, json.loads(body_text) if body_text else None
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        return e.code, json.loads(body_text) if body_text else None


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


def main():
    status, items = supabase(
        "GET",
        "/rest/v1/menu_items?select=name,clover_item_id,sauces,addons&merchant_id=eq.2cfea053-c6bc-41c2-92d9-f5f66c432bdb&limit=100",
    )
    if status != 200:
        print("Failed to load items:", status, items)
        return
    print(f"Loaded {len(items)} items")

    group_cache = {}

    for item in items:
        clover_id = item.get("clover_item_id")
        if not clover_id:
            print(f"Skipping {item['name']} (no clover_item_id)")
            continue

        sauces = []
        addons = []
        try:
            if item.get("sauces"):
                sauces = json.loads(item["sauces"])
        except Exception as e:
            print(f"Bad sauces for {item['name']}: {e}")
        try:
            if item.get("addons"):
                addons = json.loads(item["addons"])
        except Exception as e:
            print(f"Bad addons for {item['name']}: {e}")

        group_ids = []

        if sauces:
            group_name = f"{item['name']} - Sauce"
            if group_name not in group_cache:
                modifiers = [{"name": s, "price": 0} for s in sauces]
                status, res = clover(
                    "POST",
                    f"/v3/merchants/{MID}/modifier_groups",
                    {"name": group_name, "modifiers": modifiers},
                )
                if status == 200 and res and "id" in res:
                    group_cache[group_name] = res["id"]
                    print(f"Created sauce group: {group_name} -> {res['id']}")
                else:
                    print(f"Failed sauce group {group_name}: {status} {res}")
                    continue
            group_ids.append(group_cache[group_name])

        if addons:
            group_name = f"{item['name']} - Addons"
            if group_name not in group_cache:
                modifiers = [{"name": a["name"], "price": a.get("price", 0)} for a in addons]
                status, res = clover(
                    "POST",
                    f"/v3/merchants/{MID}/modifier_groups",
                    {"name": group_name, "modifiers": modifiers},
                )
                if status == 200 and res and "id" in res:
                    group_cache[group_name] = res["id"]
                    print(f"Created addon group: {group_name} -> {res['id']}")
                else:
                    print(f"Failed addon group {group_name}: {status} {res}")
                    continue
            group_ids.append(group_cache[group_name])

        for gid in group_ids:
            status, res = clover(
                "POST",
                f"/v3/merchants/{MID}/items/{clover_id}/modifier_groups",
                {"modifierGroup": {"id": gid}},
            )
            print(f"Attached {gid} to {item['name']}: {status}")

    print(f"\nDone. Created {len(group_cache)} modifier groups.")


if __name__ == "__main__":
    main()
