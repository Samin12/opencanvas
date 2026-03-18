---
name: open-canvas-workspace
description: Create markdown files or use existing workspace files, then place them on the Open Canvas board with the supported CLI workflow. Use when the user asks to make a new note, story, draft, brief, or document and have it appear on the canvas automatically.
---

# Open Canvas Workspace

Use the Open Canvas CLI instead of editing `.claude-canvas/canvas.json` by hand.

## When to use this skill

- The user wants a new markdown file to be created and shown on the canvas.
- The user wants an existing file placed on the canvas.
- The user asks for content like a story, outline, brief, memo, or plan and wants it visible on the board.

## Required workflow

1. Draft the markdown content.
2. Save it to a temporary markdown file if needed.
3. Run one of these commands from the workspace:

```bash
cat <temp-file> | {{CLI_COMMAND}} note create --workspace . --title "<title>"
{{CLI_COMMAND}} canvas add-file --workspace . --path <existing-file>
```

4. If the note should live in a specific folder, add `--target-dir <dir>` to `note create`.
5. Tell the user the exact file path that was created or placed.

## Rules

- Prefer `note create` for new markdown content.
- Prefer `canvas add-file` when the file already exists.
- Keep the file inside the active workspace.
- Do not hand-edit `canvas.json` unless the CLI path is unavailable.
