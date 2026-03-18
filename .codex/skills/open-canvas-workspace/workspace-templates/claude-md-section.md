Open Canvas note creation is installed in this workspace.

When the user wants a new markdown file or wants an existing file placed on the board:

1. Draft the markdown content.
2. Create the note with:

```bash
cat <temp-file> | {{CLI_COMMAND}} note create --workspace . --title "<title>"
```

3. If the file already exists, place it with:

```bash
{{CLI_COMMAND}} canvas add-file --workspace . --path <existing-file>
```

4. If the result is a Google Slides or other supported URL, create a new tile with:

```bash
{{CLI_COMMAND}} canvas add-url --workspace . --url <supported-url>
```

Use `--target-dir <dir>` if the note belongs in a specific folder.
Always return the exact file path that was created or placed.
Prefer the CLI over manual `canvas.json` edits.
