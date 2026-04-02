# Open Canvas Project Notes

## Interaction Principles

- Keyboard-first by default. New editor, canvas, and file interactions should be operable without a mouse whenever practical.
- Command menus must support arrow-key navigation, `Enter` or `Tab` to confirm, and `Escape` to dismiss.
- Important actions should have shortcuts or discoverable keyboard paths, not hover-only controls.
- Mouse interactions are secondary polish, not the only way to use a feature.

## Markdown Notes

- Slash menus should expose existing markdown capabilities in a visible way.
- Typing `/` in a markdown note should open a command menu near the caret.
- The slash menu should be responsive while scrolling and should avoid covering the active typing area when possible.
- Markdown note titles should auto-drive the filename when the first H1 changes.

## Canvas File Organization

- Board-generated content should prefer managed `.claude-canvas` subfolders over cluttering the workspace root.
- Explicit user file-tree actions can still honor the folder the user chose.

## Design Language

- Use the shared radius tokens in `src/renderer/src/index.css` instead of hardcoded corner values for app chrome.
- Small controls, icon buttons, compact overlays, and shortcut chips should use `var(--radius-control)` rather than square `4px` corners.
- Larger panels, tiles, viewers, and floating surfaces should use `var(--radius-surface)`.
- When a rounded tile has a separate header and body, both sections must preserve the outer radius. Do not leave the header rounded while the body or embedded surface clips square.
- New canvas UI should match the navigator and preview chrome: one font system, compact controls, and consistently rounded surfaces.
- Navigator typography should stay on `var(--font-ui)` and use only three visible sizes in normal chrome: `1rem` for the app title, `11px` for body/search/tree text, and `9px` for labels, hints, badges, and metadata.
