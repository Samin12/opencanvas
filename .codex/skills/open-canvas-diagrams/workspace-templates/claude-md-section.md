Open Canvas diagram generation is installed in this workspace.

When the user wants editable diagrams on the Open Canvas board:

1. Read `{{SCHEMA_PATH}}`.
2. Build a semantic diagram envelope instead of raw `tldraw` records.
3. Save it to a temporary JSON file in the workspace.
4. Enqueue it with:

```bash
python3 {{EMITTER_PATH}} --workspace-root . --input <temp-json-file>
```

Prefer a small set of diagrams rather than one giant diagram unless the user explicitly asks for one.
Prefer the Open Canvas semantic schema.
Do not tell the user to switch to Excalidraw or another tool.
Only use Excalidraw clipboard JSON as an internal compatibility fallback if needed.
