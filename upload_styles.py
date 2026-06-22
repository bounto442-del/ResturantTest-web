import base64
import json
import urllib.request

with open('D:/github_apikey.txt', 'r') as f:
    token = f.read().strip()

repo = 'bounto442-del/ResturantTest-web'
filepath = 'styles.css'

# 1. Get current SHA if file exists
sha = None
try:
    req_get = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/contents/{filepath}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    )
    resp_get = urllib.request.urlopen(req_get)
    data = json.loads(resp_get.read().decode())
    sha = data.get("sha")
    print(f"Current SHA: {sha}")
except urllib.error.HTTPError as e:
    if e.code == 404:
        print("File does not exist yet — creating new.")
    else:
        print(f"GET error: {e.code}")
        print(e.read().decode()[:200])

# 2. Upload / update
with open('C:/Resturant_Demo/web_app/styles.css', 'rb') as f:
    content = base64.b64encode(f.read()).decode('utf-8')

payload = {
    "message": "Add styles.css",
    "content": content
}
if sha:
    payload["sha"] = sha

req_put = urllib.request.Request(
    f"https://api.github.com/repos/{repo}/contents/{filepath}",
    data=json.dumps(payload).encode('utf-8'),
    headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
    },
    method="PUT"
)

try:
    resp_put = urllib.request.urlopen(req_put)
    print("styles.css uploaded successfully!")
except urllib.error.HTTPError as e:
    print(f"PUT error: {e.code}")
    print(e.read().decode()[:300])
