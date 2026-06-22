import base64
import json
import os
import urllib.request
import urllib.error

TOKEN = open('D:/github_apikey.txt').read().strip()
REPO = 'bounto442-del/ResturantTest-web'

def upload(filepath, repopath):
    """Upload or update a single file on GitHub."""
    sha = None
    try:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{REPO}/contents/{repopath}",
            headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json"}
        )
        resp = urllib.request.urlopen(req)
        data = json.loads(resp.read().decode())
        sha = data.get("sha")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            pass  # New file
        else:
            print(f"GET {repopath}: {e.code}")
            return False

    with open(os.path.join('C:/Resturant_Demo/web_app', filepath), 'rb') as f:
        content = base64.b64encode(f.read()).decode('utf-8')

    payload = {"message": f"Update {repopath}", "content": content}
    if sha:
        payload["sha"] = sha

    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/contents/{repopath}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json"
        },
        method="PUT"
    )
    try:
        urllib.request.urlopen(req)
        print(f"OK: {repopath}")
        return True
    except urllib.error.HTTPError as e:
        print(f"FAIL {repopath}: {e.code}")
        print(e.read().decode()[:200])
        return False

upload("index.html", "index.html")
upload("app.js", "app.js")
upload("config.js", "config.js")
upload("styles.css", "styles.css")
