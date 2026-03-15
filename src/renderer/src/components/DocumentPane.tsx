import { useEffect, useState } from 'react'

import clsx from 'clsx'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

import type { FileKind, TextFileDocument } from '@shared/types'

interface DocumentPaneProps {
  fileKind: FileKind
  filePath: string
  onPassthroughScroll?: (deltaX: number, deltaY: number) => void
  variant?: 'tile' | 'viewer'
}

function renderMarkdown(markdown: string) {
  const html = marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true
  }) as string

  return DOMPurify.sanitize(html)
}

export function DocumentPane({
  fileKind,
  filePath,
  onPassthroughScroll,
  variant = 'tile'
}: DocumentPaneProps) {
  const supportsRichPreview = fileKind === 'note'
  const [document, setDocument] = useState<TextFileDocument | null>(null)
  const [draft, setDraft] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [mode, setMode] = useState<'preview' | 'edit'>(supportsRichPreview ? 'preview' : 'edit')
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false

    setDocument(null)
    setDraft('')
    setImageUrl(null)
    setMode(supportsRichPreview ? 'preview' : 'edit')

    async function load() {
      setStatus('loading')

      try {
        if (fileKind === 'image') {
          const url = await window.collaborator.fileUrl(filePath)

          if (!cancelled) {
            setImageUrl(url)
            setStatus('idle')
          }

          return
        }

        const nextDocument = await window.collaborator.readTextFile(filePath)

        if (!cancelled) {
          setDocument(nextDocument)
          setDraft(nextDocument.content)
          setMode(
            nextDocument.kind === 'note' && nextDocument.content.trim().length === 0
              ? 'edit'
              : supportsRichPreview
                ? 'preview'
                : 'edit'
          )
          setStatus('idle')
        }
      } catch {
        if (!cancelled) {
          setStatus('error')
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [fileKind, filePath, supportsRichPreview])

  async function save() {
    if (fileKind === 'image' || document === null || draft === document.content) {
      return
    }

    setStatus('saving')

    try {
      const updated = await window.collaborator.writeTextFile(filePath, draft)
      setDocument(updated)
      setDraft(updated.content)
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  async function switchMode(nextMode: 'preview' | 'edit') {
    if (!supportsRichPreview || nextMode === mode) {
      return
    }

    if (nextMode === 'preview') {
      await save()
    }

    setMode(nextMode)
  }

  if (status === 'error') {
    return (
      <div className="flex h-full items-center justify-center rounded-[22px] border border-rose-200 bg-rose-50 p-4 text-center text-sm text-rose-700">
        This file could not be opened. Broken symlinks and deleted files should fail gracefully here.
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div
        className={clsx(
          'flex h-full items-center justify-center rounded-[16px] border border-[color:var(--line)] bg-[var(--surface-0)] text-sm text-[var(--text-dim)]',
          variant === 'viewer' ? 'rounded-[16px]' : 'rounded-[10px]'
        )}
      >
        Loading…
      </div>
    )
  }

  if (fileKind === 'image') {
    return (
      <div
        className={clsx(
          'flex h-full items-center justify-center overflow-hidden bg-[var(--surface-1)]',
          variant === 'viewer' ? 'rounded-[16px] border border-[color:var(--line)]' : 'rounded-[10px]'
        )}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="text-sm text-[var(--text-dim)]">Loading image…</div>
        )}
      </div>
    )
  }

  const renderedMarkdown = supportsRichPreview ? renderMarkdown(draft) : ''

  return (
    <div
      className={clsx(
        'relative flex h-full min-h-0 flex-col bg-[var(--surface-0)]',
        variant === 'viewer' ? 'rounded-[16px] border border-[color:var(--line)]' : 'rounded-[10px]'
      )}
    >
      {variant === 'viewer' ? (
        <div className="flex items-center justify-between border-b border-[color:var(--line)] px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-[var(--text-faint)]">
          <div>{supportsRichPreview ? 'Markdown Preview' : 'Code Surface'}</div>
          <div className="flex items-center gap-2">
            {supportsRichPreview ? (
              <div className="flex items-center rounded-full border border-[color:var(--line)] bg-[var(--surface-1)] p-0.5 text-[10px] tracking-[0.18em] text-[var(--text-dim)]">
                <button
                  className={clsx(
                    'rounded-full px-2.5 py-1 transition',
                    mode === 'preview'
                      ? 'bg-[var(--text)] text-[var(--surface-0)]'
                      : 'hover:bg-[var(--surface-2)]'
                  )}
                  onClick={() => void switchMode('preview')}
                >
                  Preview
                </button>
                <button
                  className={clsx(
                    'rounded-full px-2.5 py-1 transition',
                    mode === 'edit'
                      ? 'bg-[var(--text)] text-[var(--surface-0)]'
                      : 'hover:bg-[var(--surface-2)]'
                  )}
                  onClick={() => void switchMode('edit')}
                >
                  Edit
                </button>
              </div>
            ) : null}
            <span>{status === 'saving' ? 'Saving' : document ? 'Live file' : 'Loading'}</span>
            {mode === 'edit' || !supportsRichPreview ? (
              <button
                className="rounded-full border border-[color:var(--line)] bg-[var(--surface-1)] px-2 py-1 text-[10px] text-[var(--text-dim)] transition hover:bg-[var(--surface-2)]"
                onClick={() => void save()}
              >
                Save
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {supportsRichPreview && variant === 'tile' ? (
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2">
          <button
            className="pointer-events-auto rounded-full border border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-dim)] shadow-[0_4px_10px_rgba(15,23,42,0.06)] transition hover:bg-[var(--surface-1)]"
            onClick={() => void switchMode(mode === 'preview' ? 'edit' : 'preview')}
          >
            {mode === 'preview' ? 'Edit' : 'Preview'}
          </button>
        </div>
      ) : null}
      {supportsRichPreview && mode === 'preview' ? (
        <div
          data-scroll-lock="true"
          className={clsx(
            'markdown-preview min-h-0 flex-1 overflow-y-auto text-[var(--text)]',
            variant === 'viewer' ? 'px-6 py-5 text-[16px]' : 'px-5 py-4 text-[13px]'
          )}
          onWheel={(event) => {
            if (event.shiftKey && onPassthroughScroll) {
              event.preventDefault()
              onPassthroughScroll(event.deltaX, event.deltaY)
            }
          }}
          dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
        />
      ) : (
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onWheel={(event) => {
            if (event.shiftKey && onPassthroughScroll) {
              event.preventDefault()
              onPassthroughScroll(event.deltaX, event.deltaY)
            }
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
              event.preventDefault()
              void save()
            }

            if (supportsRichPreview && event.key === 'Escape') {
              event.preventDefault()
              void switchMode('preview')
            }
          }}
          data-scroll-lock="true"
          spellCheck={fileKind === 'note'}
          className={clsx(
            'min-h-0 flex-1 bg-transparent leading-6 text-[var(--text)] outline-none',
            variant === 'viewer' ? 'px-4 py-4' : 'px-5 py-4',
            variant === 'viewer' ? 'text-[15px]' : 'text-[13px]',
            fileKind === 'note'
              ? 'font-["Iowan_Old_Style","Palatino_Linotype","Book_Antiqua",serif]'
              : 'font-["IBM_Plex_Mono","SFMono-Regular","Menlo",monospace]'
          )}
        />
      )}
    </div>
  )
}
