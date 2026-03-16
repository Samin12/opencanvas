# Open Canvas

Electron + React foundation for Open Canvas, a spatial whiteboard workspace for development.

## What is implemented

- Electron desktop shell with persisted window state
- Resizable navigator sidebar with workspace switching
- Workspace file tree with drag-to-canvas behavior
- Infinite pan/zoom canvas with dot grid
- Tile creation, dragging, resizing, z-index ordering, and persistence
- xterm.js terminal tiles with tmux-backed session persistence
- Double-click canvas to create terminal session placeholders
- File-backed note, code, and image tiles
- Viewer overlay and quick file search (`Cmd+K`)
- Local JSON persistence in `~/.collaborator-clone/` (legacy path preserved for compatibility)

## What is intentionally deferred

- Monaco editor integration
- BlockNote / TipTap markdown editing
- File watching, rename/delete tracking, and richer navigator operations
- Auto-updater and MCP server integration

## Why this does not use TLDraw as the root canvas

The core product behavior is not whiteboarding. It is persistent, live application tiles with custom hit-testing, resize handles, z-order rules, and file/session bindings. A custom spatial layer keeps those constraints simple and predictable.

TLDraw still makes sense later for:

- freeform annotations on top of the canvas
- relationship maps / graph overlays
- embedded whiteboard zones in the same workspace
- richer multiplayer or shape tooling, if the project grows that way

## Prerequisites

- Node.js and npm
- `tmux` installed and available on your `PATH`
- Claude Code installed and available as the `claude` command on your `PATH`

On macOS, install `tmux` with:

```bash
brew install tmux
```

If you launch Claude with a different command, set `COLLABORATOR_CLAUDE_COMMAND` before starting the app.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run typecheck
npm run build
```
