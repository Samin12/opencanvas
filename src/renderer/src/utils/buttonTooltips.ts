const BUTTON_TOOLTIP_SELECTOR = 'button,[role="button"]'
const buttonTooltipBaseLabels = new WeakMap<HTMLElement, string>()

function normalizeTooltipText(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

export function composeTooltipLabel(label: string, shortcut?: string | null) {
  const normalizedLabel = normalizeTooltipText(label)
  const normalizedShortcut = normalizeTooltipText(shortcut)

  if (!normalizedShortcut) {
    return normalizedLabel
  }

  if (!normalizedLabel) {
    return normalizedShortcut
  }

  const suffixedLabel = `(${normalizedShortcut})`

  if (normalizedLabel.includes(suffixedLabel)) {
    return normalizedLabel
  }

  return `${normalizedLabel} (${normalizedShortcut})`
}

function tooltipBaseLabel(button: HTMLElement) {
  const explicitLabel = normalizeTooltipText(button.dataset.tooltip)

  if (explicitLabel) {
    buttonTooltipBaseLabels.set(button, explicitLabel)
    return explicitLabel
  }

  const ariaLabel = normalizeTooltipText(button.getAttribute('aria-label'))

  if (ariaLabel) {
    buttonTooltipBaseLabels.set(button, ariaLabel)
    return ariaLabel
  }

  const shortcut = normalizeTooltipText(button.dataset.shortcut)
  const cachedLabel = buttonTooltipBaseLabels.get(button)
  const currentTitle = normalizeTooltipText(button.getAttribute('title'))

  if (cachedLabel) {
    const cachedTooltip = composeTooltipLabel(cachedLabel, shortcut)

    if (currentTitle && currentTitle !== cachedTooltip) {
      buttonTooltipBaseLabels.set(button, currentTitle)
      return currentTitle
    }

    return cachedLabel
  }

  if (currentTitle) {
    buttonTooltipBaseLabels.set(button, currentTitle)
    return currentTitle
  }

  const textLabel = normalizeTooltipText(button.textContent)

  if (textLabel) {
    buttonTooltipBaseLabels.set(button, textLabel)
    return textLabel
  }

  return ''
}

function applyTooltip(button: HTMLElement) {
  if (button.dataset.managedTooltip === 'custom') {
    if (button.hasAttribute('title')) {
      button.removeAttribute('title')
    }

    return
  }

  const baseLabel = tooltipBaseLabel(button)

  if (!baseLabel) {
    return
  }

  const nextTitle = composeTooltipLabel(baseLabel, button.dataset.shortcut)

  if (button.getAttribute('title') !== nextTitle) {
    button.setAttribute('title', nextTitle)
  }
}

function scanButtons(root: ParentNode) {
  if (root instanceof Element && root.matches(BUTTON_TOOLTIP_SELECTOR)) {
    applyTooltip(root as HTMLElement)
  }

  if ('querySelectorAll' in root) {
    root.querySelectorAll(BUTTON_TOOLTIP_SELECTOR).forEach((button) => {
      if (button instanceof HTMLElement) {
        applyTooltip(button)
      }
    })
  }
}

export function installButtonTooltipSync(root: ParentNode = document) {
  scanButtons(root)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
        applyTooltip(mutation.target)
        continue
      }

      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) {
          scanButtons(node)
        }
      })
    }
  })

  const observationRoot = document.body ?? document.documentElement

  observer.observe(observationRoot, {
    attributeFilter: ['aria-label', 'data-shortcut', 'data-tooltip', 'title'],
    attributes: true,
    childList: true,
    subtree: true
  })

  return () => {
    observer.disconnect()
  }
}
