---
name: open-canvas-diagrams
description: Generate editable Open Canvas diagrams from an outline or prompt. Use when the user wants Claude to create one or more diagrams on the Open Canvas tldraw board from notes, plans, architecture ideas, flows, org charts, timelines, or mind maps.
---

# Open Canvas Diagrams

Generate editable diagrams for Open Canvas by emitting a semantic diagram envelope and enqueueing it for the app.

## When to use this skill

- The user wants diagrams generated onto the Open Canvas board.
- The user wants multiple diagrams from one outline.
- The user wants editable flowcharts, system diagrams, mind maps, timelines, org charts, or sequence diagrams.

## Required workflow

1. Read `.claude-canvas/tools/diagram-schema.md`.
2. Decide the diagram set.
3. Prefer the semantic JSON envelope described there. Never emit raw `tldraw` records.
4. Save the envelope to a temporary JSON file inside the workspace.
5. Run `python3 .claude-canvas/tools/emit_diagram_request.py --workspace-root . --input <temp-json-file>`.
6. Confirm that the request was queued.

If Claude strongly prefers Excalidraw JSON for a diagram, that is allowed as a fallback. Save the Excalidraw JSON to a temporary file and enqueue it with the same emitter command. Open Canvas will import it onto the tldraw board.

## Defaults

- Small outline: 2 diagrams.
- Medium outline: 3 diagrams.
- Large outline: 4 diagrams.
- Never exceed 6 diagrams.
- Prefer a diagram set over one giant diagram unless the user explicitly asks for one.
- Regeneration should append a fresh variant, not replace prior frames.

## Diagram selection guidance

- Product or system idea:
  Read `references/diagram-catalog.md` and prefer system architecture + flowchart + timeline/sequence.
- Brainstorm or concept map:
  Prefer mind map + flowchart.
- Team or responsibility breakdown:
  Prefer org chart + system architecture or flowchart.

## References

- Schema and limits: `references/diagram-schema.md`
- Diagram catalog: `references/diagram-catalog.md`
- Drive note: `references/drive-notes.md`
