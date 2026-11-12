# JC Internet Clicker v0.3 — First Show Test Checklist

Use two computers if possible: Auckland sender, Hamilton receiver, or two PCs on separate phone hotspots. **Do not rely on this beta as the only control path without rehearsing it first.**

## 1. Basic local relay

- [ ] Run `Start-Relay-Windows.bat` (Node.js 20+; internet required for first dependency install).
- [ ] Open `http://127.0.0.1:8787`, sign in as admin. Status bar says relay reachable.
- [ ] Change top-right to Advanced Mode. Add a PC under Configuration.
- [ ] Press Pair with code and note it expires in 10 minutes.
- [ ] Run receiver via `receiver/start-windows.bat`; enter relay URL and code.
- [ ] Receiver monitor says `CONNECTED`. Website status says `REMOTE CONNECTED`.
- [ ] Press **Send test signal**; the receiver logs `RECEIVED FROM INTERNET: TEST SIGNAL` then `ACK SENT`.
- [ ] Website shows receiver ACK and latency. Test twice; timestamps and latency should update.
- [ ] Disconnect the receiver. Website shows offline, and buttons reject commands.
- [ ] Reconnect. It should not fire **old** clicks that were pressed while offline.

## 2. Two different internet connections

- [ ] Serve relay using a trusted HTTPS URL; ensure GitHub Pages has that relay URL configured.
- [ ] Put sender on one Wi-Fi and remote receiver on another Wi-Fi or phone hotspot/5G.
- [ ] Confirm both connect without public router port-forwarding to PowerPoint/OSC/Companion.
- [ ] Test latency and receipt on the remote receiver monitor.
- [ ] Power-cycle the receiver Wi-Fi briefly; observe disconnect/reconnect and no queued clicks.
- [ ] Confirm the local show can be advanced independently of remote commands.
- [ ] If the relay disappears entirely, expect commands to stop. Automatic offline LAN relay migration is **not yet included**.

## 3. PowerPoint (Windows target)

- [ ] Open a PowerPoint deck **on the receiver PC**; start a slideshow.
- [ ] In the website choose the PowerPoint Next/Previous buttons on that receiver.
- [ ] Visually confirm next slide/build and previous slide/build; check output screen.
- [ ] Test First, Last, and End if you configured those commands.
- [ ] Check **Test target** on website; it should report PowerPoint open or an actionable failure.
- [ ] Try while PowerPoint closed: website should report failure, not false success.

## 4. Resolume Arena (OSC)

- [ ] On target PC open Arena, Preferences → OSC, enable incoming OSC. Default receive port = **7000**.
- [ ] Enable Arena's OSC monitor showing incoming messages.
- [ ] Click Next Column on dashboard. Arena monitor should show `/composition/connectnextcolumn`.
- [ ] Click Previous Column. Confirm actual composition column changes.
- [ ] Change the port in receiver target settings if Arena uses something other than 7000.
- [ ] Test again with a second internet connection.
- [ ] Remember: UDP `Sent` is not confirmed application `Executed`. Check Arena monitor.

## 5. Companion / Stream Deck / clickers

- [ ] Enable Companion HTTP Remote Control, usually port **8000**; click a mapped Companion button through website.
- [ ] With a sender-side receiver connected, send POST to `http://127.0.0.1:8877/trigger/BUTTON_UUID` using header `X-Clicker-Key`. Confirm website activity and remote command.
- [ ] Check wrong local key returns `401`, and disconnected sender receiver returns `503`.
- [ ] Connect USB presenter clicker to sender PC. Enable keyboard capture in monitor.
- [ ] Press physical Right / Left / PageDown / PageUp; watch Inputs feed.
- [ ] Use Learn last detected input, assign it to a remote clicker button, verify it works.
- [ ] Verify a local PowerPoint doesn't accidentally advance twice due to key capture.
- [ ] Set MIDI input name, enable monitor, learn a MIDI Note/CC and verify routing.

## 6. Custom apps and special integrations

- [ ] vMix: enable local HTTP API (typically 8088) and run a test `Cut` on a harmless preview.
- [ ] OBS: enable WebSocket 5 (typically 4455), configure its password locally, test a harmless scene change and confirm OBS response.
- [ ] MIDI output: specify a real MIDI output device, send a note/CC, check the receiving program.
- [ ] Custom HTTP, TCP and UDP: use a dummy local listener before pointing to live production equipment.
- [ ] Approved scripts: create a harmless local named script in `approved_scripts`, execute and check exit 0. Unknown script name must be rejected.
- [ ] ATEM: test with a configured Bitfocus Companion ATEM connection. Native ATEM adapter is not in this beta.

## 7. Web-only receiver (no Windows download)

- [ ] Open `browser.html` on a separate PC; create a **separate** receiver ID and pair with a code.
- [ ] Website sees that browser receiver connected.
- [ ] Send Test: browser receiver shows TEST RECEIVED and ACK; site reports success.
- [ ] Try an application action: should report `Browser receiver monitor cannot run local application commands` rather than claiming success.
- [ ] Enable capture on the browser page, focus it, press keyboard Right/Left. Check input feed.

## 8. Shows, macros, permissions and UI

- [ ] Create a show profile, assign a button to it, switch profiles and verify button visibility.
- [ ] Build a two-step macro from buttons on different computers. Test Parallel (both attempted), then Sequence (ordered). Confirm the result.
- [ ] Disconnect second receiver; macro should stop with an error and not queue future clicks.
- [ ] Create Operator account. Operator should click and test but receive **403** when editing settings.
- [ ] Test configuration export, import and the receiver key is not inside the exported file.
- [ ] Test Simple/Advanced, light/dark, fullscreen, compact/responsive mobile and optional logo.
- [ ] Test `Start-Studio-Windows.bat` on actual Windows, start/stop its integrated receiver and use native buttons.
- [ ] Build EXEs using GitHub Actions on Windows and test standalone portable Receiver/Studio on a clean machine.

## 9. Final show readiness

- [ ] Keep a manual presenter clicker or local fallback available.
- [ ] Share the correct login and target PC names with authorised operators.
- [ ] Confirm Windows sleep/power settings won't suspend the receiver.
- [ ] Confirm the remote receiving PCs have the actual target applications running.
- [ ] Confirm Internet, power, signal routing and show cue order before doors.
- [ ] Keep long-lived logs safe, and never publish `config.json`, `.env` or `state.json`.
