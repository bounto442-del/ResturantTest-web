# Deploy Static Web App to Synology NAS

This guide hosts only the HTML/JS frontend on the Synology NAS. The backend stays on Vercel and Supabase stays in the cloud.

## 1. Prepare Synology

1. Install **Web Station** from Package Center (it installs Apache and PHP).
2. In DSM, open **Web Station → Web Service Portal → Create**.
3. Choose:
   - **Portal type:** Name-based or Port-based (port 80/443 for public, or a custom port like 8080 for local-only).
   - **Document root:** Browse to the shared folder where you copied the web app, e.g. `/volume1/web/restaurant`.
4. (Optional) For HTTPS/public access: **Control Panel → Login Portal → Reverse Proxy** → create a rule that maps `https://yourdomain.com` to `http://localhost:80` or your custom port, and add a Let’s Encrypt certificate.

## 2. Copy the Web App Files

### Option A: Use the PowerShell script

From this repo folder (`D:\Resturant_Demo\web_app`) run:

```powershell
.\deploy\synology\deploy.ps1 `
  -NasIp "192.168.4.75" `
  -User "Claude" `
  -Password (Read-Host "Enter password" -AsSecureString) `
  -Share "web" `
  -TargetFolder "restaurant"
```

The script maps the NAS share, mirrors the static files into `\\192.168.4.75\web\restaurant`, then disconnects.

### Option B: Manual copy

1. In DSM, open **File Station** and create a folder, e.g. `web/restaurant`.
2. From your PC, copy these files/folders into it:
   - `index.html`
   - `config.js`
   - `app.js`
   - `clover.js`
   - Any image assets or `assets/` folder.
3. In Web Station, point the virtual host document root at that folder.

## 3. Test

- Local: `http://192.168.4.75/restaurant` (or whichever port/path you set).
- Public: `https://yourdomain.com`.

Open the browser console and confirm:
- `ENV.cloverBackendUrl` still points to `https://clover-restaurant-backend.vercel.app`.
- `ENV.supabaseUrl` still points to the cloud Supabase project.

The app should behave exactly like the GitHub Pages version, just served from the NAS.

## 4. Keep It in Sync

After any future web app changes, re-run the deploy script. The `?v=17` cache-busting query strings in `index.html` will update on the next release.

## Notes

- No changes are needed on Vercel or Supabase for this.
- If you later want a public domain, the only update is the DNS A-record pointing to your home IP, plus port-forwarding 443 to the Synology. The backend redirect URI in the Clover dev dashboard only matters for the owner dashboard login on Vercel, not the static web app.
