Create a markdown note in the active workspace and place it on the Open Canvas board.

Workflow:

1. Draft the markdown content.
2. Save it to a temporary markdown file in the workspace if needed.
3. Run one of these commands:

```bash
cat <temp-file> | {{CLI_COMMAND}} note create --workspace . --title "<title>"
{{CLI_COMMAND}} note create --workspace . --title "<title>" --input <markdown-file>
{{CLI_COMMAND}} canvas add-file --workspace . --path <existing-file>
{{CLI_COMMAND}} canvas add-url --workspace . --url <supported-url>
```

Rules:

- Prefer `note create` for new markdown files.
- Use `--target-dir <dir>` when the note should live in a specific folder.
- Use `canvas add-file` for existing files.
- Use `canvas add-url` for Google Slides and other supported URLs.
- Return the exact file path that was created or placed.
- Do not edit `.claude-canvas/canvas.json` by hand when the CLI is available.
