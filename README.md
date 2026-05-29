# Hermes Browser Bridge

> **📖 Documentation Language:** English | [Bahasa Indonesia](README_ID.md)

Hermes Browser Bridge connects an AI Agent (LLM) with an already-open and authenticated Chrome browser session. The agent can capture accessibility tree snapshots, click, type, navigate, and take screenshots on the active tab — without opening a new browser.

## About

This repository provides **Hermes Agent** integration with the user's browser. The agent runs through a browser session, leveraging **human fingerprint** for authentication and interaction, enabling automated workflows that feel natural and are difficult to distinguish from manual activity. With a local bridge-based architecture, you gain full browser control without network exposure.

## Highlights
- Local transport via WebSocket (`ws://127.0.0.1:8787`) and optional stdio (MCP).
- Chrome Extension (Manifest V3) serves as executor using Chrome DevTools Protocol (CDP).
- Designed for WSL2 (agent on Linux) + Chrome on Windows scenarios.

## Architecture (Brief)

AI Agent ⇆ Bridge Server (Node.js) ⇆ Chrome Extension ⇆ Active Tab

The bridge acts as a JSON-RPC / JSON-over-stdio intermediary, forwarding agent requests to the extension and waiting for responses.

## Key Features
- Capture accessibility tree + screenshot (`browser_snapshot`).
- Interact with elements via `ref` ID (e.g., `browser_click`, `browser_type`).
- Additional tools: `browser_find_element`, `browser_press_key`, `browser_execute_script`, `browser_tabs`, and more.
- Security: binds only to `127.0.0.1` (local) — does not expose port to the network.

## Requirements
- Node.js v18+
- Google Chrome / Chromium / Edge v116+

## Quickstart

1) Install dependencies and run the Bridge:

```bash
cd bridge/
npm install
npm start
```

2) Load the extension in Chrome:

1. Open `chrome://extensions/`
2. Enable *Developer mode*
3. Click *Load unpacked* → select the `extension/` folder

3) Once the bridge is running, the extension will automatically attempt to connect to `ws://127.0.0.1:8787`.

## Usage

Simple JSON-RPC example via WebSocket:

Request snapshot:

```json
{"jsonrpc":"2.0","id":1,"method":"browser_snapshot","params":{}}
```

Click an element by `ref`:

```json
{"jsonrpc":"2.0","id":2,"method":"browser_click","params":{"ref":"e2"}}
```

Alternatively, run Bridge as an MCP/stdio server for integration with clients like Claude Desktop or Cursor. Configuration examples are available in the respective MCP client documentation.

## Tools Summary

- `browser_snapshot`: capture accessibility tree + screenshot
- `browser_click`: click element by `ref`
- `browser_type`: type text into input by `ref`
- `browser_press_key`: send keyboard event
- `browser_find_element`: search element in last snapshot
- `browser_navigate`: open URL and capture snapshot
- `browser_screenshot`: capture screenshot only
- `browser_scroll`, `browser_wait`, `browser_tabs`, `browser_switch_tab`, `browser_execute_script`, `browser_wait_for_selector`, `browser_open_new_tab`

For full schema definitions of each tool, see `bridge/index.js` (function `getToolDefinitions`).

## WSL2 (Linux Agent) + Chrome on Windows

The architecture supports running an agent on WSL2 while Chrome runs on Windows. If you encounter connection issues, consider enabling `networkingMode=mirrored` in `%USERPROFILE%\.wslconfig` or run the bridge directly on Windows.

## Security

- Bridge listens only on `127.0.0.1`.
- Extension performs `chrome.debugger` attach/detach per operation.
- For production: add token authentication to WebSocket connections.

## Development

- Server entry point: `bridge/index.js`
- Dependencies: see `bridge/package.json`
- Extension manifest: `extension/manifest.json`

To add new protocol features: add tool definitions in `getToolDefinitions()` in `bridge/index.js` and implement handling in the extension.

## Contributing

Contribution suggestions:

1. Fork the repo and create a feature branch.
2. Open a PR with a description of changes and reasoning.
3. Include manual examples or small scripts for feature verification.

## License

The project license is not yet specified in the repo. Add a `LICENSE` file if you want to set a public license.

---

**Available in other languages:** [Bahasa Indonesia](README_ID.md)
