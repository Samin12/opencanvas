Create one or more editable Open Canvas diagrams for the active workspace.

Workflow:

1. Read `{{SCHEMA_PATH}}`.
2. Decide the best diagram set for the user prompt.
3. Produce only the semantic JSON envelope from that schema.
4. Save the JSON to a temporary file in the workspace.
5. Run:

```bash
python3 {{EMITTER_PATH}} --workspace-root . --input <temp-json-file>
```

Rules:

- Prefer multiple diagrams over one crowded diagram.
- Default to 2 diagrams for a small outline, 3 for a medium outline, 4 for a large outline.
- Never exceed 6 diagrams.
- Do not emit raw `tldraw` JSON.
- Prefer the Open Canvas semantic schema.
- Do not tell the user to switch to Excalidraw or another tool.
- Only use Excalidraw clipboard JSON as a silent compatibility fallback when the Open Canvas schema is not workable.
- After enqueueing, tell the user that Open Canvas should import the new diagram frames automatically.
