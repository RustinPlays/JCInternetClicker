# GitHub & Internet Deployment (v0.3)

## A — Publish operator dashboard (GitHub Pages)

1. Create a public GitHub repository, ideally `RustinPlays/JC-Internet-Clicker`, and upload the extracted contents. **Do not** upload `config.json`, `.env`, `state.json`, or a `.venv` folder.
2. Open **Settings → Pages**, choose **GitHub Actions** as source.
3. The workflow `.github/workflows/pages.yml` builds and deploys `docs/` on changes to `main`.
4. Once Pages deploys, open the URL shown in Settings → Pages. You will first be asked for your *relay* URL.
5. For the no-download receiver-only page, open `YOUR_GITHUB_PAGES_URL/browser.html`.

**Pages cannot serve WebSockets or store relay credentials**. The static client connects to the separately hosted HTTPS API.

## B — Deploy the relay

1. On an always-on Windows or Linux PC/server, install Node.js 20+.
2. In `server/` run `npm install`, `npm run setup`, then `npm start` (Windows can use `Start-Relay-Windows.bat`).
3. The relay listens on localhost port `8787` by default. Do not expose HTTP directly to the public internet.
4. Put it behind a correctly configured HTTPS reverse proxy, e.g. Cloudflare Tunnel. Example public host: `relay-clicker.justincreative.tech` (illustrative, not deployed).
5. In the private `server/.env` add an allowed GitHub Pages origin to `WEB_ORIGINS`, e.g. `WEB_ORIGINS=https://rustinplays.github.io` (replace with your actual browser origin). If using a different dashboard domain, add that origin too, separated by commas. The relay itself is allowed same-origin.
6. Restart the Node relay. Visit the relay's `/api/health` endpoint to verify it returns the version and `ok:true`.
7. On GitHub Pages, click **Relay settings** and enter the full `https://` relay origin. Log in.
8. Create receiver entries and pair each Windows receiver with a ten-minute code. Make sure receiver uses **this same HTTPS relay URL**.

With Cloudflare Tunnel, the connector runs on the relay host and forwards HTTPS requests (including WebSockets) to `http://127.0.0.1:8787` without port forwarding. Keep the tunnel online during show.

**Security:** Protect the machine and private state file; keep auth credentials off GitHub. Use authenticated admin/operator accounts. Preserve TLS to all public clients. Keep receiver target networks restricted. The local Companion HTTP API should not be reachable from the internet.

## C — Get portable EXE downloads from GitHub

1. In **Actions**, run **Windows Portable Apps** manually, or push a version tag such as `v0.3.0`.
2. Wait for the successful run and download `JC-Clicker-Windows-Portable` from the workflow **Artifacts**. On a version tag it also publishes a GitHub Release with standalone receiver and Studio EXEs.
3. Extract both EXEs into a writable folder. Both use `config.json` in the executable's folder; pair only once, then use Studio or Receiver (not both at the same time with one receiver ID).
4. These are **unsigned beta builds**. Windows may prompt; verify the archive is from your own repository before running.

No standalone EXE is inside the source ZIP provided in this conversation. GitHub Actions must build it on Windows first.

## D — Standalone Windows app (source mode)

`receiver/start-windows.bat` sets up the small receiver; `Start-Studio-Windows.bat` installs Studio dependencies separately, then runs the integrated app. Python 3.11+ is required for source mode. The app can open an embedded dashboard with `pywebview` or fall back to the browser.

## E — Rehearsal checks

Use `TEST_CHECKLIST.md` before the first show: network status, receiver ACK, PowerPoint, Resolume OSC monitor, Stream Deck HTTP POST, key/MIDI inputs, local controls and internet outage behavior.
