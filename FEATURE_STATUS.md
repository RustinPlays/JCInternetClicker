# JC Internet Clicker v0.3 — Selected features and build status

**Built in source, with local unit/API smoke checks**

- Browser dashboard with username/password, separate Admin and Operator roles.
- Lightweight Windows receiver with outbound relay connection, live log/ACK monitor and pairing code.
- Web-only receiver monitor (test/ACK/input only; no Windows/UDP control).
- Native Windows Studio source app: relay login, buttons, receiver status/test, logs, local config, embedded dashboard when pywebview available.
- GitHub Pages site + Windows EXE build workflows and Windows launcher scripts.
- Custom targets with IP, port, OSC, HTTP(S), TCP, UDP; Companion and vMix HTTP; OBS WebSocket; MIDI output; approved local scripts; keyboard shortcuts.
- USB keyboard-style clicker monitor, local Stream Deck/Companion HTTP POST trigger bridge, MIDI input monitor and Learn Input mapping.
- Live receiver status, last ping/ACK, input/command activity, searchable-by-view logs, CSV download, reject-offline and reconnect logic.
- Shows, profile-linked buttons, multi-PC parallel or sequential macros with optional delays.
- One-time receiver pairing code, operator roles, import/export profile configurations, secrets excluded from exports.
- Broadcast Dark, dark/light mode, Simple/Advanced, responsive controls, fullscreen, saved browser-specific branding/logo.

**Implemented but awaiting real Windows / AV equipment tests**

- PowerPoint COM controls and application probe.
- Resolume Arena OSC and actual clip/column advance.
- USB clicker hardware detection, Stream Deck/Companion hardware HTTP triggers, MIDI devices/drivers.
- OBS, vMix and Companion against real installed versions.
- Windows tray minimisation, autostart and standalone PyInstaller EXE build.
- Full Windows Studio embedded webview and local settings handling.
- Full public relay over HTTPS/WSS on different internet connections.

**Partial / planned, not yet complete**

- Automatic updates: checks releases; automatic verified installation is pending.
- Offline LAN fallback: automatic failover/local relay is pending (manual trusted alternate path only).
- Direct native ATEM protocol: pending; ATEM is controllable via configured Bitfocus Companion modules.
- Fully packaged Windows standalone apps: workflow is included, but EXEs must be built and verified on Windows after the GitHub repository exists.
- Full browser UI end-to-end test: browser navigation was blocked in the build environment; DOM IDs and JS syntax checked instead.

**Deliberately excluded (user unchecked)**

- Sound alerts when receivers disconnect.
- Advanced arbitrary CSS editor.

## Acceptance criteria for going live

1. Web sender and remote receiver connect over two different internet connections.
2. Test button appears on both screens with ACK + latency.
3. PowerPoint and Arena tests actually change the target application's state.
4. Stream Deck / USB hardware inputs reliably trigger only the intended targets.
5. Offline/disconnect/reconnect does not replay stale commands.
6. A local operator can still advance their own show independently.
7. GitHub Windows EXE build and live deployment are successfully tested.
