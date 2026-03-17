# Open Canvas Diagram Schema

Emit a JSON object with this envelope:

```json
{
  "version": 1,
  "skill": "open-canvas-diagrams",
  "requestId": "req_...",
  "createdAt": "2026-03-16T22:00:00.000Z",
  "promptSummary": "3 diagrams from launch outline",
  "diagrams": []
}
```

Each diagram:

```json
{
  "id": "overview",
  "title": "System Overview",
  "kind": "system-architecture",
  "summary": "Optional short summary",
  "nodes": [],
  "edges": []
}
```

Node shape:

```json
{
  "id": "api",
  "label": "API Service",
  "kind": "service",
  "cluster": "Runtime",
  "lane": "Platform",
  "order": 2,
  "emphasis": "high"
}
```

Edge shape:

```json
{
  "id": "api-db",
  "from": "api",
  "to": "db",
  "label": "reads / writes",
  "style": "solid",
  "direction": "one-way"
}
```

Allowed diagram kinds:

- `flowchart`
- `system-architecture`
- `mind-map`
- `sequence`
- `org-chart`
- `timeline`

Allowed node kinds:

- `process`
- `decision`
- `data`
- `actor`
- `service`
- `database`
- `document`
- `container`
- `note`
- `event`

Hard limits:

- max 6 diagrams per request
- max 40 nodes per diagram
- max 80 edges per diagram
- max label length 140

Rules:

- Emit semantic diagrams only. Do not emit raw `tldraw` records.
- Every edge must reference existing node ids.
- Prefer several smaller diagrams to one crowded diagram.
- Use `cluster`, `lane`, and `order` whenever they help layout.

Fallback:

- If a request clearly fits Excalidraw better and Claude is already producing Excalidraw JSON, Open Canvas can also import Excalidraw clipboard-style JSON as a fallback.
- In that case, enqueue the Excalidraw JSON with the same emitter script instead of the semantic envelope.
