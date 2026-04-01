# Open Canvas

Electron + React foundation for Open Canvas, a spatial whiteboard workspace for development.

## Install the macOS app

If you want the release build in `Applications` so Spotlight can find it, use the installer script:

```bash
curl -fsSL https://raw.githubusercontent.com/Samin12/opencanvas/main/install.sh | bash
```

You can also pass a specific GitHub release page or direct DMG link:

```bash
curl -fsSL https://raw.githubusercontent.com/Samin12/opencanvas/main/install.sh | bash -s -- \
  "https://github.com/Samin12/opencanvas/releases/tag/v0.1.0"
```

The script downloads the matching DMG and copies `Open Canvas.app` into `/Applications`.

## What is implemented

- Electron desktop shell with persisted window state
- Resizable navigator sidebar with workspace switching
- Workspace file tree with drag-to-canvas behavior
- Infinite pan/zoom canvas with dot grid
- Tile creation, dragging, resizing, z-index ordering, and persistence
- xterm.js terminal tiles with tmux-backed session persistence
- Double-click canvas to create terminal session placeholders
- File-backed note, code, image, video, PDF, spreadsheet, and presentation tiles
- Viewer overlay and quick file search (`Cmd+K`)
- Iframe embeds for YouTube, Vimeo, Loom, Figma, remote PDFs, and generic webpages
- Native CSV/TSV table viewing plus ONLYOFFICE-backed Excel / PowerPoint viewing
- GitHub release update notifications with in-app install and relaunch
- Local JSON persistence in `~/.collaborator-clone/` (legacy path preserved for compatibility)

## What is intentionally deferred

- Monaco editor integration
- BlockNote / TipTap markdown editing
- File watching, rename/delete tracking, and richer navigator operations
- Binary delta auto-updater and MCP server integration

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
- Codex installed and available as the `codex` command on your `PATH` if you want Codex terminals
- Bun `>=1.3.9` if you want T1Code terminals (`bunx @maria_rcks/t1code`)
- Docker Desktop or Docker Engine if you want full-fidelity Excel / PowerPoint viewing

On macOS, install `tmux` with:

```bash
brew install tmux
```

By default, Open Canvas launches:

- `claude --dangerously-skip-permissions`
- `codex --dangerously-bypass-approvals-and-sandbox`
- `bunx @maria_rcks/t1code`

Open Canvas terminals also expose an `open-canvas-cli` command automatically, so Claude Code and Codex sessions inside the app can call the workspace CLI without extra setup.

When you switch into a workspace, Open Canvas also installs workspace instructions for Claude and Codex plus a local `open-canvas-workspace` skill so agents know how to create notes, place files, and add supported URLs to the board with the supported CLI path.

If you want different launch commands, override them before starting the app:

```bash
export COLLABORATOR_CLAUDE_COMMAND="claude"
export COLLABORATOR_CODEX_COMMAND="codex"
export OPEN_CANVAS_T1CODE_COMMAND="t1code"
```

## Office viewer

PDFs, local videos, CSVs, and URL embeds work with the normal app runtime.

For `.xls`, `.xlsx`, `.ods`, `.ppt`, `.pptx`, and `.odp`, Open Canvas uses ONLYOFFICE Docs in read-only mode. In a local dev checkout, Open Canvas can try to start the helper automatically when Docker and `docker-compose.onlyoffice.yml` are available. Presentation tiles also expose a `PDF preview` fallback when a local converter like Keynote or LibreOffice is available. You can also start ONLYOFFICE manually with:

```bash
npm run office:up
```

Useful commands:

```bash
npm run office:logs
npm run office:down
```

Environment overrides:

- `OPEN_CANVAS_ONLYOFFICE_URL` defaults to `http://127.0.0.1:8080`
- `OPEN_CANVAS_PREVIEW_SERVER_PORT` pins the local preview server port
- `OPEN_CANVAS_PREVIEW_HOST_ALIAS` overrides the host alias ONLYOFFICE uses to fetch local files

## Run

```bash
npm install
npm run dev
```

If you want to install the packaged macOS app from this repo instead of running the dev build:

```bash
bash ./install.sh
```

Useful CLI examples inside an Open Canvas terminal:

```bash
open-canvas-cli status
cat draft.md | open-canvas-cli note create --workspace . --title "Story Draft"
open-canvas-cli canvas add-file --workspace . --path notes/existing.md
open-canvas-cli canvas add-url --workspace . --url "https://docs.google.com/presentation/d/..."
```

## Build

```bash
npm run typecheck
npm run build
```
