const SHORTCUT_LOCK_SELECTOR =
  '[data-shortcut-lock="true"], .xterm, .ProseMirror, [contenteditable="true"], [role="textbox"]'

function resolveElement(target: EventTarget | Element | null) {
  if (target instanceof Element) {
    return target
  }

  if (target instanceof Node) {
    return target.parentElement
  }

  return null
}

export function elementHandlesTyping(target: EventTarget | Element | null) {
  const element = resolveElement(target)

  if (!element) {
    return false
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return true
  }

  if (
    (element instanceof HTMLElement && element.isContentEditable) ||
    element.getAttribute('role') === 'textbox'
  ) {
    return true
  }

  return Boolean(element.closest(SHORTCUT_LOCK_SELECTOR))
}

export function keyboardShortcutsBlocked(target: EventTarget | null) {
  return elementHandlesTyping(target) || elementHandlesTyping(document.activeElement)
}
