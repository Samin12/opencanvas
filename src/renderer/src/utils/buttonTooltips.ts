const BUTTON_TOOLTIP_SELECTOR = 'button,[role="button"]'
const buttonTooltipBaseLabels = new WeakMap<HTMLElement, string>()
const TOOLTIP_EDGE_PADDING = 72
const TOOLTIP_OFFSET = 10
const TOOLTIP_FLIP_THRESHOLD = 52

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

  if (button.hasAttribute('title')) {
    button.removeAttribute('title')
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

  const doc = root instanceof Document ? root : root.ownerDocument ?? document
  const tooltip = doc.createElement('div')
  const label = doc.createElement('span')
  const shortcut = doc.createElement('span')
  let activeButton: HTMLElement | null = null

  tooltip.hidden = true
  tooltip.setAttribute('role', 'tooltip')
  tooltip.className = 'app-tooltip app-tooltip--top'
  label.className = 'app-tooltip__label'
  shortcut.className = 'app-tooltip__shortcut'
  tooltip.append(label, shortcut)
  ;(doc.body ?? doc.documentElement).appendChild(tooltip)

  function tooltipData(button: HTMLElement) {
    if (button.dataset.managedTooltip === 'custom') {
      return null
    }

    const baseLabel = tooltipBaseLabel(button)

    if (!baseLabel) {
      return null
    }

    return {
      label: baseLabel,
      shortcut: normalizeTooltipText(button.dataset.shortcut) || null
    }
  }

  function positionTooltip(button: HTMLElement) {
    const rect = button.getBoundingClientRect()
    const topSpace = rect.top
    const bottomSpace = window.innerHeight - rect.bottom
    const placement =
      topSpace < TOOLTIP_FLIP_THRESHOLD && bottomSpace > topSpace ? 'bottom' : 'top'
    const anchorCenter = rect.left + rect.width / 2
    const left = Math.min(
      Math.max(anchorCenter, TOOLTIP_EDGE_PADDING),
      window.innerWidth - TOOLTIP_EDGE_PADDING
    )

    tooltip.classList.toggle('app-tooltip--top', placement === 'top')
    tooltip.classList.toggle('app-tooltip--bottom', placement === 'bottom')
    tooltip.style.left = `${left}px`
    tooltip.style.top = `${placement === 'top' ? rect.top - TOOLTIP_OFFSET : rect.bottom + TOOLTIP_OFFSET}px`
  }

  function hideTooltip() {
    activeButton = null
    tooltip.hidden = true
  }

  function showTooltip(button: HTMLElement) {
    const data = tooltipData(button)

    if (!data || button.matches(':disabled')) {
      hideTooltip()
      return
    }

    activeButton = button
    label.textContent = data.label
    shortcut.hidden = !data.shortcut
    shortcut.textContent = data.shortcut ?? ''
    tooltip.hidden = false
    positionTooltip(button)
  }

  function buttonFromEventTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) {
      return null
    }

    const candidate = target.closest(BUTTON_TOOLTIP_SELECTOR)
    return candidate instanceof HTMLElement ? candidate : null
  }

  function handlePointerOver(event: PointerEvent) {
    const button = buttonFromEventTarget(event.target)

    if (!button || button === activeButton) {
      return
    }

    showTooltip(button)
  }

  function handlePointerOut(event: PointerEvent) {
    if (!activeButton) {
      return
    }

    const nextButton = buttonFromEventTarget(event.relatedTarget)

    if (nextButton === activeButton) {
      return
    }

    hideTooltip()
  }

  function handleFocusIn(event: FocusEvent) {
    const button = buttonFromEventTarget(event.target)

    if (!button) {
      return
    }

    showTooltip(button)
  }

  function handleFocusOut(event: FocusEvent) {
    if (!activeButton) {
      return
    }

    const nextButton = buttonFromEventTarget(event.relatedTarget)

    if (nextButton === activeButton) {
      return
    }

    hideTooltip()
  }

  function handleViewportChange() {
    if (activeButton) {
      positionTooltip(activeButton)
    }
  }

  doc.addEventListener('pointerover', handlePointerOver, true)
  doc.addEventListener('pointerout', handlePointerOut, true)
  doc.addEventListener('focusin', handleFocusIn, true)
  doc.addEventListener('focusout', handleFocusOut, true)
  doc.addEventListener('pointerdown', hideTooltip, true)
  doc.addEventListener('keydown', hideTooltip, true)
  window.addEventListener('scroll', handleViewportChange, true)
  window.addEventListener('resize', handleViewportChange)

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
    doc.removeEventListener('pointerover', handlePointerOver, true)
    doc.removeEventListener('pointerout', handlePointerOut, true)
    doc.removeEventListener('focusin', handleFocusIn, true)
    doc.removeEventListener('focusout', handleFocusOut, true)
    doc.removeEventListener('pointerdown', hideTooltip, true)
    doc.removeEventListener('keydown', hideTooltip, true)
    window.removeEventListener('scroll', handleViewportChange, true)
    window.removeEventListener('resize', handleViewportChange)
    tooltip.remove()
  }
}
