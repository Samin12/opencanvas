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
