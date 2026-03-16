import { useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react'

import clsx from 'clsx'
import { createPortal } from 'react-dom'

type TooltipPlacement = 'top' | 'bottom'

interface HoverTooltipProps {
  children: ReactNode
  label: string
  placement?: TooltipPlacement
  shortcut?: string | null
}

interface TooltipPosition {
  left: number
  placement: TooltipPlacement
  top: number
}

const TOOLTIP_EDGE_PADDING = 72
const TOOLTIP_OFFSET = 10
const TOOLTIP_FLIP_THRESHOLD = 52

export function HoverTooltip({
  children,
  label,
  placement = 'top',
  shortcut
}: HoverTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  useLayoutEffect(() => {
    if (!open || typeof window === 'undefined') {
      return
    }

    const updatePosition = () => {
      const anchor = anchorRef.current

      if (!anchor) {
        return
      }

      const rect = anchor.getBoundingClientRect()
      const topSpace = rect.top
      const bottomSpace = window.innerHeight - rect.bottom
      const resolvedPlacement =
        placement === 'top'
          ? topSpace < TOOLTIP_FLIP_THRESHOLD && bottomSpace > topSpace
            ? 'bottom'
            : 'top'
          : bottomSpace < TOOLTIP_FLIP_THRESHOLD && topSpace > bottomSpace
            ? 'top'
            : 'bottom'
      const anchorCenter = rect.left + rect.width / 2
      const left = Math.min(
        Math.max(anchorCenter, TOOLTIP_EDGE_PADDING),
        window.innerWidth - TOOLTIP_EDGE_PADDING
      )

      setPosition({
        left,
        placement: resolvedPlacement,
        top:
          resolvedPlacement === 'top'
            ? rect.top - TOOLTIP_OFFSET
            : rect.bottom + TOOLTIP_OFFSET
      })
    }

    updatePosition()

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, placement])

  const normalizedLabel = label.trim()

  if (!normalizedLabel) {
    return <>{children}</>
  }

  return (
    <span
      ref={anchorRef}
      className="inline-flex"
      onBlurCapture={(event: FocusEvent<HTMLSpanElement>) => {
        const nextFocusTarget = event.relatedTarget

        if (!(nextFocusTarget instanceof Node) || !event.currentTarget.contains(nextFocusTarget)) {
          setOpen(false)
        }
      }}
      onFocusCapture={() => setOpen(true)}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      {children}
      {open && position && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="tooltip"
              className={clsx(
                'pointer-events-none fixed z-[400] flex max-w-[20rem] items-center gap-2 rounded-[6px] border border-[color:var(--line-strong)] bg-[color:var(--surface-overlay)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text)] shadow-[0_12px_32px_rgba(15,23,42,0.18)] backdrop-blur-sm',
                position.placement === 'top'
                  ? '-translate-x-1/2 -translate-y-full'
                  : '-translate-x-1/2'
              )}
              style={{
                left: position.left,
                top: position.top
              }}
            >
              <span className="leading-none text-[var(--text)]">{normalizedLabel}</span>
              {shortcut ? (
                <span className="shrink-0 rounded-[4px] border border-[color:var(--accent)] bg-[var(--accent-soft)] px-1.5 py-0.5 font-[var(--font-mono)] text-[10px] leading-none tracking-[0.08em] text-[var(--accent)]">
                  {shortcut}
                </span>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </span>
  )
}
