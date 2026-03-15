import { useEffect, useState } from 'react'

import clsx from 'clsx'

import type { FileKind, TextFileDocument } from '@shared/types'

interface DocumentPaneProps {
  fileKind: FileKind
  filePath: string
  onPassthroughScroll?: (deltaX: number, deltaY: number) => void
  variant?: 'tile' | 'viewer'
}

export function DocumentPane({
  fileKind,
  filePath,
  onPassthroughScroll,
  variant = 'tile'
}: DocumentPaneProps) {
  const [document, setDocument] = useState<TextFileDocument | null>(null)
  const [draft, setDraft] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false

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
  }, [fileKind, filePath])

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

  if (status === 'error') {
    return (
      <div className="flex h-full items-center justify-center rounded-[22px] border border-rose-200 bg-rose-50 p-4 text-center text-sm text-rose-700">
        This file could not be opened. Broken symlinks and deleted files should fail gracefully here.
      </div>
    )
  }

  if (fileKind === 'image') {
    return (
      <div
        className={clsx(
          'flex h-full items-center justify-center overflow-hidden bg-[#faf7f0]',
          variant === 'viewer' ? 'rounded-[16px] border border-slate-200' : 'rounded-[10px]'
        )}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="text-sm text-slate-500">Loading image…</div>
        )}
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'flex h-full min-h-0 flex-col bg-[#fffdfa]',
        variant === 'viewer' ? 'rounded-[16px] border border-slate-200' : 'rounded-[10px]'
      )}
    >
      {variant === 'viewer' ? (
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
          <div>{fileKind === 'note' ? 'Markdown Surface' : 'Code Surface'}</div>
          <div className="flex items-center gap-2">
            <span>{status === 'saving' ? 'Saving' : document ? 'Live file' : 'Loading'}</span>
            <button
              className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 transition hover:bg-slate-50"
              onClick={() => void save()}
            >
              Save
            </button>
          </div>
        </div>
      ) : null}
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
        }}
        data-scroll-lock="true"
        spellCheck={fileKind === 'note'}
        className={clsx(
          'min-h-0 flex-1 bg-transparent leading-6 text-slate-800 outline-none',
          variant === 'viewer' ? 'px-4 py-4' : 'px-5 py-4',
          variant === 'viewer' ? 'text-[15px]' : 'text-[13px]',
          fileKind === 'note'
            ? 'font-["Iowan_Old_Style","Palatino_Linotype","Book_Antiqua",serif]'
            : 'font-["IBM_Plex_Mono","SFMono-Regular","Menlo",monospace]'
        )}
      />
    </div>
  )
}
