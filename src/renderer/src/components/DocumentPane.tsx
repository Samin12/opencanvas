import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import clsx from 'clsx'

import type { FileKind, TextFileDocument } from '@shared/types'

interface DocumentPaneProps {
  fileKind: FileKind
  filePath: string
  onPassthroughScroll?: (deltaX: number, deltaY: number) => void
  variant?: 'tile' | 'viewer'
}

type DocumentStatus = 'idle' | 'loading' | 'saving' | 'error'

interface SurfaceFrameProps {
  children: ReactNode
  fileKind: Exclude<FileKind, 'image'>
  onRefresh?: () => void
  status: DocumentStatus
  variant: 'tile' | 'viewer'
}

function SurfaceFrame({ children, fileKind, onRefresh, status, variant }: SurfaceFrameProps) {
  return (
    <div
      className={clsx(
        'relative flex h-full min-h-0 flex-col bg-[var(--surface-0)]',
        variant === 'viewer' ? 'rounded-[16px] border border-[color:var(--line)]' : 'rounded-[10px]'
      )}
    >
      {variant === 'viewer' ? (
        <div className="flex items-center justify-between border-b border-[color:var(--line)] px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-[var(--text-faint)]">
          <div>{fileKind === 'note' ? 'Note Surface' : 'Code Surface'}</div>
          <div className="flex items-center gap-2">
            {onRefresh ? (
              <button
                className="rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-0.5 text-[10px] tracking-[0.16em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
                onClick={onRefresh}
                title="Refresh file"
              >
                Refresh
              </button>
            ) : null}
            <span>{status === 'saving' ? 'Saving' : 'Live file'}</span>
          </div>
        </div>
      ) : null}
      {variant === 'tile' && onRefresh ? (
        <button
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-overlay)] text-[12px] text-[var(--text-dim)] shadow-[0_4px_10px_rgba(15,23,42,0.08)] backdrop-blur transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)]"
          onClick={onRefresh}
          title="Refresh file"
        >
          ↻
        </button>
      ) : null}
      {children}
    </div>
  )
}

function LoadingPane({ variant }: { variant: 'tile' | 'viewer' }) {
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

function ErrorPane({ variant }: { variant: 'tile' | 'viewer' }) {
  return (
    <div
      className={clsx(
        'flex h-full items-center justify-center rounded-[22px] border border-rose-200 bg-rose-50 p-4 text-center text-sm text-rose-700',
        variant === 'viewer' ? 'rounded-[16px]' : 'rounded-[10px]'
      )}
    >
      This file could not be opened. Broken symlinks and deleted files should fail gracefully here.
    </div>
  )
}

function useFileChangeSignal(filePath: string) {
  const [changeCount, setChangeCount] = useState(0)

  useEffect(() => {
    return window.collaborator.onFileChanged(filePath, () => {
      setChangeCount((current) => current + 1)
    })
  }, [filePath])

  return changeCount
}

function RichNoteEditor({
  filePath,
  initialContent,
  onDocumentChange,
  onPassthroughScroll,
  onStatusChange,
  onRefresh,
  status,
  variant
}: {
  filePath: string
  initialContent: string
  onDocumentChange: (document: TextFileDocument) => void
  onPassthroughScroll?: (deltaX: number, deltaY: number) => void
  onStatusChange: (status: DocumentStatus) => void
  onRefresh: () => void
  status: DocumentStatus
  variant: 'tile' | 'viewer'
}) {
  const latestDraftRef = useRef(initialContent)
  const latestSavedRef = useRef(initialContent)
  const saveRequestIdRef = useRef(0)
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    latestDraftRef.current = initialContent
    latestSavedRef.current = initialContent
    onStatusChange('idle')
  }, [initialContent, onStatusChange])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  async function persist(markdown: string) {
    const requestId = saveRequestIdRef.current + 1
    saveRequestIdRef.current = requestId

    try {
      const updated = await window.collaborator.writeTextFile(filePath, markdown)

      if (saveRequestIdRef.current !== requestId) {
        return
      }

      latestDraftRef.current = updated.content
      latestSavedRef.current = updated.content
      onDocumentChange(updated)
      onStatusChange('idle')
    } catch {
      if (saveRequestIdRef.current === requestId) {
        onStatusChange('error')
      }
    }
  }

  function clearScheduledSave() {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }

  function flushSave() {
    clearScheduledSave()

    if (latestDraftRef.current === latestSavedRef.current) {
      onStatusChange('idle')
      return
    }

    onStatusChange('saving')
    void persist(latestDraftRef.current)
  }

  function queueSave(markdown: string) {
    latestDraftRef.current = markdown
    clearScheduledSave()

    if (markdown === latestSavedRef.current) {
      onStatusChange('idle')
      return
    }

    onStatusChange('saving')
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void persist(latestDraftRef.current)
    }, 260)
  }

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit,
        Markdown.configure({
          markedOptions: {
            breaks: true,
            gfm: true
          }
        })
      ],
      content: initialContent,
      contentType: 'markdown',
      editorProps: {
        attributes: {
          class: clsx(
            'markdown-preview rich-note-editor__content h-full w-full text-[var(--text)] outline-none',
            variant === 'viewer' ? 'px-6 py-5 text-[16px]' : 'px-5 py-4 text-[13px]'
          ),
          spellcheck: 'true'
        },
        handleDOMEvents: {
          blur: () => {
            flushSave()
            return false
          }
        }
      },
      onUpdate: ({ editor: activeEditor }) => {
        queueSave(activeEditor.getMarkdown())
      }
    },
    [filePath, initialContent, variant]
  )

  if (!editor) {
    return <LoadingPane variant={variant} />
  }

  return (
    <SurfaceFrame fileKind="note" onRefresh={onRefresh} status={status} variant={variant}>
      <div
        className="rich-note-editor min-h-0 flex-1"
        onWheel={(event) => {
          if (event.shiftKey && onPassthroughScroll) {
            event.preventDefault()
            onPassthroughScroll(event.deltaX, event.deltaY)
          }
        }}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>
    </SurfaceFrame>
  )
}

function NoteDocumentPane({
  filePath,
  onPassthroughScroll,
  variant = 'tile'
}: Omit<DocumentPaneProps, 'fileKind'>) {
  const [document, setDocument] = useState<TextFileDocument | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [status, setStatus] = useState<DocumentStatus>('loading')
  const fileChangeCount = useFileChangeSignal(filePath)

  useEffect(() => {
    setDocument(null)
    setStatus('loading')
  }, [filePath])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const nextDocument = await window.collaborator.readTextFile(filePath)

        if (!cancelled) {
          setDocument(nextDocument)
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
  }, [filePath, fileChangeCount, reloadCount])

  if (status === 'error') {
    return <ErrorPane variant={variant} />
  }

  if (!document || status === 'loading') {
    return <LoadingPane variant={variant} />
  }

  return (
    <RichNoteEditor
      key={`${filePath}:${document.updatedAt}`}
      filePath={filePath}
      initialContent={document.content}
      onDocumentChange={setDocument}
      onPassthroughScroll={onPassthroughScroll}
      onRefresh={() => setReloadCount((current) => current + 1)}
      onStatusChange={setStatus}
      status={status}
      variant={variant}
    />
  )
}

function CodeDocumentPane({
  filePath,
  onPassthroughScroll,
  variant = 'tile'
}: Omit<DocumentPaneProps, 'fileKind'>) {
  const [document, setDocument] = useState<TextFileDocument | null>(null)
  const [draft, setDraft] = useState('')
  const [reloadCount, setReloadCount] = useState(0)
  const [status, setStatus] = useState<DocumentStatus>('loading')
  const fileChangeCount = useFileChangeSignal(filePath)

  useEffect(() => {
    setDocument(null)
    setDraft('')
    setStatus('loading')
  }, [filePath])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
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
  }, [filePath, fileChangeCount, reloadCount])

  async function save() {
    if (!document || draft === document.content) {
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
    return <ErrorPane variant={variant} />
  }

  if (!document || status === 'loading') {
    return <LoadingPane variant={variant} />
  }

  return (
    <SurfaceFrame
      fileKind="code"
      onRefresh={() => setReloadCount((current) => current + 1)}
      status={status}
      variant={variant}
    >
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
        spellCheck={false}
        className={clsx(
          'min-h-0 flex-1 bg-transparent leading-6 text-[var(--text)] outline-none',
          variant === 'viewer' ? 'px-4 py-4 text-[15px]' : 'px-5 py-4 text-[13px]',
          'font-["IBM_Plex_Mono","SFMono-Regular","Menlo",monospace]'
        )}
      />
    </SurfaceFrame>
  )
}

function ImageDocumentPane({
  filePath,
  variant = 'tile'
}: Pick<DocumentPaneProps, 'filePath' | 'variant'>) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [status, setStatus] = useState<DocumentStatus>('loading')
  const fileChangeCount = useFileChangeSignal(filePath)

  useEffect(() => {
    setImageUrl(null)
    setStatus('loading')
  }, [filePath])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const nextImageUrl = await window.collaborator.fileUrl(filePath)

        if (!cancelled) {
          setImageUrl(`${nextImageUrl}${nextImageUrl.includes('?') ? '&' : '?'}v=${Date.now()}`)
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
  }, [filePath, fileChangeCount, reloadCount])

  if (status === 'error') {
    return <ErrorPane variant={variant} />
  }

  if (!imageUrl || status === 'loading') {
    return <LoadingPane variant={variant} />
  }

  return (
    <div
      className={clsx(
        'relative flex h-full items-center justify-center overflow-hidden bg-[var(--surface-1)]',
        variant === 'viewer' ? 'rounded-[16px] border border-[color:var(--line)]' : 'rounded-[10px]'
      )}
    >
      <button
        className={clsx(
          'absolute z-10 flex h-6 min-w-6 items-center justify-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-2 text-[11px] text-[var(--text-dim)] shadow-[0_4px_10px_rgba(15,23,42,0.08)] backdrop-blur transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)]',
          variant === 'viewer' ? 'right-3 top-3' : 'right-2 top-2'
        )}
        onClick={() => setReloadCount((current) => current + 1)}
        title="Refresh image"
      >
        ↻
      </button>
      <img src={imageUrl} alt="" className="h-full w-full object-contain" />
    </div>
  )
}

export function DocumentPane({
  fileKind,
  filePath,
  onPassthroughScroll,
  variant = 'tile'
}: DocumentPaneProps) {
  if (fileKind === 'image') {
    return <ImageDocumentPane filePath={filePath} variant={variant} />
  }

  if (fileKind === 'note') {
    return (
      <NoteDocumentPane
        filePath={filePath}
        onPassthroughScroll={onPassthroughScroll}
        variant={variant}
      />
    )
  }

  return (
    <CodeDocumentPane
      filePath={filePath}
      onPassthroughScroll={onPassthroughScroll}
      variant={variant}
    />
  )
}
