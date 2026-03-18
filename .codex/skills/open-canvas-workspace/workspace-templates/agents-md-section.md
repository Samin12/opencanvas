Open Canvas workspace note tooling is installed here.

When the user asks to create a markdown file and have it appear on the board:

1. Draft the markdown content.
2. Run:

```bash
cat <temp-file> | {{CLI_COMMAND}} note create --workspace . --title "<title>"
```

3. If the file already exists, run:

```bash
{{CLI_COMMAND}} canvas add-file --workspace . --path <existing-file>
```

4. If the result is a Google Slides or other supported URL, run:

```bash
{{CLI_COMMAND}} canvas add-url --workspace . --url <supported-url>
```

Use `--target-dir <dir>` when the note belongs in a specific folder.
Prefer this CLI workflow over editing `.claude-canvas/canvas.json` directly.
