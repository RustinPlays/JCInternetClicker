# JC Internet Clicker — v0.3 Beta

A browser-operated remote clicker for AV shows with a small Windows receiver and a fuller Windows Studio. Built for different networks (Wi-Fi, 5G, Ethernet) and independent local operator control.

**This is a beta, not a production-tested replacement for show controls.** Test with both machines and the actual PowerPoint/Resolume software before your event. No server, domain, or GitHub site is automatically deployed by extracting the ZIP.

## Three ways to use it

| Mode | Needs on operator PC | Needs on target PC | Can send application commands? |
| --- | --- | --- | --- |
| **Website + small receiver (recommended)** | Browser only | Receiver EXE, or Python `receiver/start-windows.bat` | Yes |
| **Browser receiver monitor** | Browser only | Browser only | **No** — live test, acknowledgment, key inputs while page focused |
| **JC Clicker Studio (Windows)** | Full Studio EXE, or `Start-Studio-Windows.bat` | Built-in receiver on that same PC; external receivers on other PCs | Yes, when receivers are paired |

**Important:** GitHub Pages serves only the dashboard files from `docs/`. It cannot host the authenticated relay. Host the `server/` Node relay on an always-on PC/server behind HTTPS (Cloudflare Tunnel or other TLS reverse proxy). The receivers make outbound WebSocket connections; you do **not** forward 7000/8000/8088/4455 or receiver ports to the public internet.

## First setup / local demonstration

1. Install **Node.js 20+** on the PC that will act as the relay.
2. Double-click `Start-Relay-Windows.bat`. First run installs the `ws` dependency and prompts you for a strong admin username/password. On this local PC, open `http://127.0.0.1:8787`.
3. Sign in. If the website starts in **Simple Mode**, click **Advanced Mode** at the top.
4. **Configuration → Add PC + starter buttons**; name it `Hamilton Arena PC` or `Auckland PowerPoint PC`.
5. Click **Pair with code** beside that PC. Copy the code (expires in ten minutes).
6. On the target Windows PC, run `receiver/start-windows.bat`. The pairing window asks for your relay URL and code. Enter them and save. A connected receiver monitor should appear.
7. Back on the website, open **Connections & tests**, choose the PC and press **Send test signal**. The target PC should display `RECEIVED FROM INTERNET: TEST SIGNAL` and `ACK SENT`. The website should show acknowledgment and latency.
8. For PowerPoint, start the slideshow then use Next/Previous. For Arena, enable OSC input in Resolume preferences, port 7000, and test Next Column, using Resolume's incoming OSC monitor to verify.
9. If you want to control from a **different network**, publish the relay securely over HTTPS, then update the receiver's `server_url` in its local `config.json`, restart receiver, and use that relay URL in the browser dashboard.

**Two computers do not need to be on the same Wi-Fi.** They both reach the central relay over internet connections. The receiver still needs to reach each local AV app by `127.0.0.1` or another explicitly permitted LAN IP.

### Browser-only receiver (no download)

On a second computer, open `https://YOUR-GITHUB-PAGES-SITE/browser.html` or `http://127.0.0.1:8787/browser.html` on local test. Create a **separate receiver** in Configuration, generate its pairing code, enter the same relay URL and code in the web-only receiver. It displays live tests and ACK messages. It **cannot** control PowerPoint/Resolume or send OSC/UDP directly. Do **not** connect the browser to an existing Windows receiver ID, as only one active connection per receiver is allowed.

## Operator inputs

**USB presenter clicker:** The sender PC must run Receiver (or Studio), enable keyboard clicker detection and map an input in **Inputs / Stream Deck**. Most standard presenter remotes produce Right/Left/PageDown/PageUp; `Learn last detected input` helps identify one. Global keyboard interception does **not** mean the remote is uniquely identifiable: avoid local double-advances.

**Stream Deck / Companion input:** On the **sender PC** with the receiver running, configure a Companion HTTP POST action:

- URL: `http://127.0.0.1:8877/trigger/BUTTON_UUID` (copy in the dashboard)
- Header: `X-Clicker-Key: YOUR_LOCAL_RECEIVER_INPUT_SECRET` (defaults to receiver key; can set a separate `input_secret` locally)

This localhost bridge is not exposed to the internet. `POST /input/right` can trigger the key mapping instead. The receiver must be connected to the relay.

**MIDI inputs:** Install `mido` and `python-rtmidi` (included in normal receiver requirements), set `midi_input_name` in local receiver config, enable MIDI detection, then press a key and select **Learn last detected input** on the website. MIDI output actions specify an exact output device name and note/CC/program values. Devices must be available on the receiver PC.

## Destinations / ready-to-use integrations

- **PowerPoint:** Windows desktop PowerPoint COM. `pywin32` installed by receiver setup. Start, Next, Previous, First, Last, End, Go To.
- **Resolume Arena:** OSC UDP to `127.0.0.1:7000` by default. You can specify any allowed OSC address and argument. UDP send is not proof that the clip advanced.
- **Bitfocus Companion:** HTTP POST `/api/location/PAGE/ROW/COLUMN/press` to locally configured Companion server (usually port 8000). Supports down/up/rotations, provided that Companion's HTTP Remote Control is enabled. Does not require direct Companion internet access.
- **vMix:** HTTP API to locally configured port (usually 8088) using a `Function` and optional `Input`.
- **OBS Studio:** Native OBS WebSocket 5.x request. Typically port 4455; OBS password is entered **only on the receiver PC** (`obs_password`), never the website. Start/stop stream and record, transitions and scene selection.
- **ATEM:** Control **through Bitfocus Companion**, with a Companion module for ATEM. Native direct ATEM protocol is *not* included in this beta.
- **Generic:** UDP, TCP, OSC, HTTP/HTTPS, keyboard shortcuts, MIDI, and **locally approved** scripts. Custom IPs and ports are restricted by `allowed_networks` set on receiver.

Example approved script mapping (only on receiver's private `config.json`):

```json
"approved_scripts": {"show-preset": ["C:\\Tools\\show-preset.exe", "--preset", "3"]}
```

Web callers only choose the script name; they cannot send a raw shell command or arbitrary arguments. Execution uses `shell=False` and a timeout. Leave `approved_scripts` empty if not needed.

## Show profiles, multiple PCs and macros

Open **Shows & macros** (Advanced Mode) to create profiles like `Genesis Auckland` and `Genesis Hamilton`. The default starter buttons belong to `Default Show`. New buttons are assigned to the selected show. Build a macro from existing buttons, with optional 0–5000ms delays, up to 16 steps. Use **Parallel** to send commands to multiple receiver PCs concurrently, or **Sequence** to send in order. Sequence stops at the first reported failure; Parallel attempts all steps and reports each result. Network differences mean parallel sends are **not guaranteed frame-accurate**. Commands are sent **live** — missed show clicks are never replayed on reconnect. Local PowerPoint/Resolume controls remain independent from other machines.

## Tests and status meanings

- **Relay online:** Browser can contact server; this is not the receiver status.
- **Receiver connected:** A receiver has authenticated an active WebSocket connection.
- **Test ACK:** The receiver received a test packet and replied. Latency is relay round trip, not a guarantee of the AV software response.
- **HTTP / Companion / OBS response:** The receiver heard an application response. For OBS a successful request result is verified.
- **OSC/UDP sent:** The receiver transmitted the datagram, **not** proof of Arena reception. Use Arena OSC monitor.
- **PowerPoint COM:** The local application accepted the command call; visually verify the slide.
- **Offline:** Clicks are rejected, not queued. Automatic reconnect resumes future controls.

## Accounts and backups

Admin password is set during relay setup. In **Admin & exports**, add Operator usernames (password 12+ characters). Operators can send controls and test but cannot edit targets or show configuration. Config export includes show profiles, button actions, macros and logs but **does not include receiver keys, password hashes or accounts**. Imported controls only attach to receivers already present on that relay. Admin and operator login sessions live in server memory and expire after twelve hours.

The receiver holds its secret in `config.json` adjacent to the receiver program/EXE. **Never publish** `config.json`, `server/.env` or `server/state.json` to GitHub; `.gitignore` excludes them.

## Appearance

Broadcast Dark is the default. The website has dark/light, Simple/Advanced, mobile/desktop responsive buttons, fullscreen, and optional local logo + show title. Selected theme and branding are **stored locally in that browser**; only show profiles, targets, buttons and macros sync across logins. A raw custom CSS editor is deliberately not included, per feature choices.

## Windows executable builds

The project includes a **GitHub Actions Windows workflow**, which builds two portable standalone EXEs with PyInstaller (receiver and Studio), places them together in `JC-Clicker-Windows-Portable.zip` and, on a version tag, attaches them to a GitHub Release. These EXEs **cannot be built or tested on Linux**. Until that Windows build runs, use the included Python launchers (`receiver/start-windows.bat` and `Start-Studio-Windows.bat`). These launchers download dependencies on first use and are **not standalone EXEs**.

The full Studio has native operator buttons, online connection tests, integrated receiver with logs, input testing, local settings editor and a full web dashboard launched in an embedded webview when installed (falls back to browser). The website remains the preferred advanced multi-device show editor.

## Beta limitations / features not yet production-complete

- **Automatic updates:** Studio checks GitHub Releases for newer versions; automated *signed/verified download and installation* is not implemented yet. Release tags trigger builds, not auto-installation.
- **LAN fallback:** A standalone automatic offline relay and session migration are **not implemented**. For now, keep an alternative trusted HTTPS path to the *same* relay and reconfigure its URL manually if needed; test this before relying on it. Direct internet-only setup stops when internet fails.
- **Native ATEM:** Use Companion to translate actions; no direct native ATEM adapter yet.
- **Update/pairing UX:** Windows installer/EXE output and tray behavior require Windows acceptance testing. EXEs generated by the workflow are unsigned.
- **Physical hardware:** Windows PowerPoint/Resolume, actual USB clickers, Stream Deck hardware, MIDI drivers and vMix/ATEM gear have not been tested in this environment.
- **Cloud hosting:** GitHub Pages and relay deployment are prepared but not live. The user must create a repository, enable Pages, and deploy an HTTPS relay.

## What is in this ZIP

- `docs/`: GitHub Pages static operator interface and browser-only receiver
- `server/`: Node 20+ relay and authenticated API / WebSocket (requires `npm install`)
- `receiver/`: Windows receiver + pairing wizard + tray/autostart + local HTTP input bridge
- `desktop/`: full Windows Studio (Python/Tk, optional embedded pywebview)
- `.github/workflows/`: Windows app building & Pages deployment workflows
- `tests/`: protocol tests and smoke checks
- `TEST_CHECKLIST.md`: rehearsal checks
- `GITHUB_SETUP.md`: upload, Pages and HTTPS relay configuration

For the exact test sequence, open **TEST_CHECKLIST.md**.
