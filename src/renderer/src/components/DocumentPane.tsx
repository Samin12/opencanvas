import {
  memo,
  type ClipboardEvent as ReactClipboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode
} from 'react'

import type { Editor as TiptapEditor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor } from '@tiptap/react'
import { TaskList } from '@tiptap/extension-list'
import StarterKit from '@tiptap/starter-kit'
import clsx from 'clsx'

import type { FileKind, TextFileDocument } from '@shared/types'
import {
  imageAltTextFromPath,
  imageFileCandidateFromPath,
  MarkdownImageExtension,
  normalizeMarkdownImageReferences,
  relativeImagePath
} from '../utils/markdownImages'
import { MarkdownShortcutExtension, MarkdownTaskItem } from '../utils/markdownShortcuts'

const COLLABORATOR_FILE_MIME = 'application/x-collaborator-file'

interface DocumentPaneProps {
  fileKind: FileKind
  filePath: string
  onImportImageFile?: (file: File) => Promise<{ name: string; path: string } | null>
  onPassthroughScroll?: (deltaX: number, deltaY: number) => void
  refreshToken?: number
  showTileRefreshButton?: boolean
  showViewerRefreshButton?: boolean
  variant?: 'tile' | 'viewer'
}

type DocumentStatus = 'idle' | 'loading' | 'saving' | 'error'

interface SurfaceFrameProps {
  children: ReactNode
  fileKind: Exclude<FileKind, 'image'>
  onRefresh?: () => void
  showTileRefreshButton?: boolean
  showViewerRefreshButton?: boolean
  status: DocumentStatus
  variant: 'tile' | 'viewer'
}

function SurfaceFrame({
  children,
  fileKind,
  onRefresh,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
  status,
  variant
}: SurfaceFrameProps) {
  const statusLabel = status === 'saving' ? 'Saving' : 'Synced'

  return (
    <div
      className={clsx(
        'relative flex h-full min-h-0 flex-col bg-[var(--surface-0)]',
        variant === 'viewer'
          ? 'overflow-hidden rounded-[6px] border border-[color:var(--line)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]'
          : 'rounded-[4px]'
      )}
    >
      {variant === 'viewer' ? (
        <div className="flex items-center justify-between border-b border-[color:var(--line)] bg-[color:var(--surface-1)]/82 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
            {fileKind === 'note' ? 'Note Surface' : 'Code Surface'}
          </div>
          <div className="flex items-center gap-2">
            {onRefresh && showViewerRefreshButton ? (
              <button
                className="rounded-[4px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
                onClick={onRefresh}
                title="Refresh file"
              >
                Refresh
              </button>
            ) : null}
            <div className="rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)]">
              {statusLabel}
            </div>
          </div>
        </div>
      ) : null}
      {variant === 'tile' && onRefresh && showTileRefreshButton ? (
        <button
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-[4px] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] text-[12px] text-[var(--text-dim)] shadow-[0_4px_10px_rgba(15,23,42,0.08)] backdrop-blur transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)]"
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
        'flex h-full items-center justify-center rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] text-sm text-[var(--text-dim)]',
        variant === 'viewer' ? 'rounded-[6px]' : 'rounded-[4px]'
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
        'flex h-full items-center justify-center rounded-[4px] border p-4 text-center text-sm',
        'border-[color:var(--error-line)] bg-[var(--error-bg)] text-[var(--error-text)]',
        variant === 'viewer' ? 'rounded-[6px]' : 'rounded-[4px]'
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
  onImportImageFile,
  onPassthroughScroll,
  onStatusChange,
  onRefresh,
  showTileRefreshButton,
  showViewerRefreshButton,
  status,
  variant
}: {
  filePath: string
  initialContent: string
  onDocumentChange: (document: TextFileDocument) => void
  onImportImageFile?: (file: File) => Promise<{ name: string; path: string } | null>
  onPassthroughScroll?: (deltaX: number, deltaY: number) => void
  onStatusChange: (status: DocumentStatus) => void
  onRefresh: () => void
  showTileRefreshButton?: boolean
  showViewerRefreshButton?: boolean
  status: DocumentStatus
  variant: 'tile' | 'viewer'
}) {
  const normalizedInitialContent = normalizeMarkdownImageReferences(initialContent)
  const latestDraftRef = useRef(normalizedInitialContent)
  const latestSavedRef = useRef(normalizedInitialContent)
  const saveRequestIdRef = useRef(0)
  const saveTimerRef = useRef<number | null>(null)

  function focusEditor(position?: 'end') {
    if (!editor) {
      return
    }

    if (position === 'end') {
      editor.commands.focus('end')
      return
    }

    editor.commands.focus()
  }

  function dropInsertionPosition(clientX: number, clientY: number) {
    if (!editor) {
      return null
    }

    return editor.view.posAtCoords({ left: clientX, top: clientY })?.pos ?? null
  }

  function draggedImageReference(dataTransfer: DataTransfer | null) {
    const rawPayload = dataTransfer?.getData(COLLABORATOR_FILE_MIME)

    if (!rawPayload) {
      return null
    }

    try {
      const payload = JSON.parse(rawPayload) as {
        fileKind?: FileKind
        name?: string
        path?: string
      }

      if (typeof payload.path !== 'string') {
        return null
      }

      if (payload.fileKind !== 'image' && !imageFileCandidateFromPath(payload.path)) {
        return null
      }

      return {
        altText: imageAltTextFromPath(payload.name ?? payload.path),
        path: payload.path
      }
    } catch {
      return null
    }
  }

  function insertImageReference(
    imagePath: string,
    altText: string | null,
    insertionPosition: number | null = null
  ) {
    if (!editor) {
      return false
    }

    const relativeSourcePath = relativeImagePath(filePath, imagePath)
    const chain = editor.chain().focus()

    if (typeof insertionPosition === 'number') {
      chain.setTextSelection(insertionPosition)
    }

    return chain
      .insertContent([
        {
          attrs: {
            alt: altText?.trim() || imageAltTextFromPath(imagePath),
            src: relativeSourcePath
          },
          type: 'image'
        },
        {
          type: 'paragraph'
        }
      ])
      .run()
  }

  async function importAndInsertImageFiles(files: File[], insertionPosition: number | null = null) {
    if (!onImportImageFile) {
      return false
    }

    let inserted = false
    let nextInsertionPosition = insertionPosition

    for (const imageFile of files) {
      const importedNode = await onImportImageFile(imageFile)

      if (!importedNode) {
        continue
      }

      if (insertImageReference(importedNode.path, imageAltTextFromPath(importedNode.name), nextInsertionPosition)) {
        inserted = true
        nextInsertionPosition = null
      }
    }

    return inserted
  }

  function handleImagePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    if (!onImportImageFile) {
      return
    }

    const imageItem = Array.from(event.clipboardData.items).find((item) =>
      item.type.startsWith('image/')
    )
    const imageFile = imageItem?.getAsFile()

    if (!imageFile) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    focusEditor()
    void importAndInsertImageFiles([imageFile], editor?.state.selection.from ?? null)
  }

  function handleImageDragOver(event: ReactDragEvent<HTMLDivElement>) {
    const draggedImage = draggedImageReference(event.dataTransfer)
    const droppedImageFiles = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      file.type.startsWith('image/')
    )

    if (!draggedImage && droppedImageFiles.length === 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleImageDrop(event: ReactDragEvent<HTMLDivElement>) {
    const draggedImage = draggedImageReference(event.dataTransfer)
    const droppedImageFiles = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      file.type.startsWith('image/')
    )

    if (!draggedImage && droppedImageFiles.length === 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const insertionPosition = dropInsertionPosition(event.clientX, event.clientY)

    if (draggedImage) {
      insertImageReference(draggedImage.path, draggedImage.altText, insertionPosition)
      return
    }

    void importAndInsertImageFiles(droppedImageFiles, insertionPosition)
  }

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
      const updated = await window.collaborator.writeTextFile(
        filePath,
        normalizeMarkdownImageReferences(markdown)
      )

      if (saveRequestIdRef.current !== requestId) {
        return
      }

      latestSavedRef.current = updated.content
      onDocumentChange(updated)

      if (latestDraftRef.current === updated.content) {
        onStatusChange('idle')
        return
      }

      onStatusChange('saving')
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
        TaskList,
        MarkdownTaskItem.configure({
          HTMLAttributes: {
            'data-type': 'taskItem'
          }
        }),
        MarkdownImageExtension.configure({
          documentPath: filePath
        }),
        MarkdownShortcutExtension,
        Markdown.configure({
          markedOptions: {
            breaks: true,
            gfm: true
          }
        })
      ],
      content: normalizedInitialContent,
      contentType: 'markdown',
      editorProps: {
        attributes: {
          class: clsx(
            'markdown-preview rich-note-editor__content h-full w-full text-[var(--text)] outline-none',
            variant === 'viewer' ? 'px-6 py-5 text-[16px]' : 'px-5 py-4 text-[13px]'
          ),
          'data-scroll-lock': 'true',
          spellcheck: 'true'
        },
        handleDOMEvents: {
          blur: () => {
            flushSave()
            return false
          },
          focus: (_view: unknown, event: FocusEvent) => {
            event.stopPropagation()
            return false
          },
          keydown: (_view: unknown, event: KeyboardEvent) => {
            event.stopPropagation()
            return false
          },
          keyup: (_view: unknown, event: KeyboardEvent) => {
            event.stopPropagation()
            return false
          },
          keypress: (_view: unknown, event: KeyboardEvent) => {
            event.stopPropagation()
            return false
          },
          mousedown: (_view: unknown, event: MouseEvent) => {
            event.stopPropagation()
            focusEditor()
            return false
          },
          paste: (_view: unknown, event: ClipboardEvent) => {
            const clipboardItems = event.clipboardData ? Array.from(event.clipboardData.items) : []
            const imageItem = clipboardItems.find((item) =>
              item.type.startsWith('image/')
            )
            const imageFile = imageItem?.getAsFile()

            if (!imageFile || !onImportImageFile) {
              return false
            }

            event.preventDefault()
            event.stopPropagation()
            void importAndInsertImageFiles([imageFile], editor?.state.selection.from ?? null)
            return true
          }
        }
      },
      onUpdate: ({ editor: activeEditor }: { editor: TiptapEditor }) => {
        queueSave(activeEditor.getMarkdown())
      }
    },
    [filePath, variant]
  )

  useEffect(() => {
    if (!editor) {
      latestDraftRef.current = initialContent
      latestSavedRef.current = normalizedInitialContent
      return
    }

    const normalizedContent = normalizeMarkdownImageReferences(initialContent)
    const hadLocalChanges = latestDraftRef.current !== latestSavedRef.current
    latestSavedRef.current = normalizedContent

    if (latestDraftRef.current === normalizedContent) {
      onStatusChange('idle')
      return
    }

    if (editor.getMarkdown() === normalizedContent) {
      latestDraftRef.current = normalizedContent
      onStatusChange('idle')
      return
    }

    if (!hadLocalChanges) {
      latestDraftRef.current = normalizedContent
      editor.commands.setContent(normalizedContent, {
        contentType: 'markdown',
        emitUpdate: false
      })
      onStatusChange('idle')
      return
    }

    onStatusChange('saving')
  }, [editor, initialContent, normalizedInitialContent, onStatusChange])

  useLayoutEffect(() => {
    if (!editor || variant !== 'viewer') {
      return
    }

    focusEditor('end')

    const frameId = window.requestAnimationFrame(() => {
      focusEditor('end')
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [editor, variant])

  if (!editor) {
    return <LoadingPane variant={variant} />
  }

  return (
    <SurfaceFrame
      fileKind="note"
      onRefresh={onRefresh}
      showTileRefreshButton={showTileRefreshButton}
      showViewerRefreshButton={showViewerRefreshButton}
      status={status}
      variant={variant}
    >
      <div
        className="rich-note-editor min-h-0 flex-1"
        data-document-drop-target="true"
        data-shortcut-lock="true"
        onDragOverCapture={handleImageDragOver}
        onDropCapture={handleImageDrop}
        onPasteCapture={handleImagePaste}
        onPointerEnter={() => {
          if (variant === 'viewer') {
            focusEditor()
          }
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          focusEditor()
        }}
        onKeyDown={(event) => event.stopPropagation()}
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
  onImportImageFile,
  onPassthroughScroll,
  refreshToken = 0,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
  variant = 'tile'
}: Omit<DocumentPaneProps, 'fileKind'>) {
  const [document, setDocument] = useState<TextFileDocument | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [status, setStatus] = useState<DocumentStatus>('loading')
  const fileChangeCount = useFileChangeSignal(filePath)

  useEffect(() => {
    if (refreshToken > 0) {
      setReloadCount((current) => current + 1)
    }
  }, [refreshToken])

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
      filePath={filePath}
      initialContent={document.content}
      onDocumentChange={setDocument}
      onImportImageFile={onImportImageFile}
      onPassthroughScroll={onPassthroughScroll}
      onRefresh={() => setReloadCount((current) => current + 1)}
      onStatusChange={setStatus}
      showTileRefreshButton={showTileRefreshButton}
      showViewerRefreshButton={showViewerRefreshButton}
      status={status}
      variant={variant}
    />
  )
}

function CodeDocumentPane({
  filePath,
  onPassthroughScroll,
  refreshToken = 0,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
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
    if (refreshToken > 0) {
      setReloadCount((current) => current + 1)
    }
  }, [refreshToken])

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
      showTileRefreshButton={showTileRefreshButton}
      showViewerRefreshButton={showViewerRefreshButton}
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

          event.stopPropagation()
        }}
        data-shortcut-lock="true"
        data-scroll-lock="true"
        spellCheck={false}
        className={clsx(
          'min-h-0 flex-1 bg-transparent leading-6 text-[var(--text)] outline-none [overscroll-behavior:contain]',
          variant === 'viewer' ? 'px-4 py-4 text-[15px]' : 'px-5 py-4 text-[13px]',
          'font-[var(--font-mono)]'
        )}
      />
    </SurfaceFrame>
  )
}

function ImageDocumentPane({
  filePath,
  refreshToken = 0,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
  variant = 'tile'
}: Pick<
  DocumentPaneProps,
  'filePath' | 'refreshToken' | 'showTileRefreshButton' | 'showViewerRefreshButton' | 'variant'
>) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [status, setStatus] = useState<DocumentStatus>('loading')
  const fileChangeCount = useFileChangeSignal(filePath)

  useEffect(() => {
    setImageUrl(null)
    setStatus('loading')
  }, [filePath])

  useEffect(() => {
    if (refreshToken > 0) {
      setReloadCount((current) => current + 1)
    }
  }, [refreshToken])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const nextImage = await window.collaborator.readImageAsset(filePath)

        if (!cancelled) {
          setImageUrl(`data:${nextImage.mimeType};base64,${nextImage.base64}`)
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
        variant === 'viewer' ? 'rounded-[6px] border border-[color:var(--line)]' : 'rounded-[4px]'
      )}
    >
      {(variant === 'tile' && showTileRefreshButton) ||
      (variant === 'viewer' && showViewerRefreshButton) ? (
        <button
          className={clsx(
            'absolute z-10 flex h-6 min-w-6 items-center justify-center rounded-[4px] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-2 text-[11px] text-[var(--text-dim)] shadow-[0_4px_10px_rgba(15,23,42,0.08)] backdrop-blur transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)]',
            variant === 'viewer' ? 'right-3 top-3' : 'right-2 top-2'
          )}
          onClick={() => setReloadCount((current) => current + 1)}
          title="Refresh image"
        >
          ↻
        </button>
      ) : null}
      <img
        src={imageUrl}
        alt=""
        draggable
        className="h-full w-full object-contain"
        onDragStart={(event) => {
          if (!event.dataTransfer) {
            return
          }

          const fileName = filePath.split(/[\\/]/).pop() ?? 'Image'

          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData(
            COLLABORATOR_FILE_MIME,
            JSON.stringify({
              fileKind: 'image',
              name: fileName,
              path: filePath
            })
          )
          event.dataTransfer.setData('text/plain', filePath)
        }}
      />
    </div>
  )
}

function DocumentPaneComponent({
  fileKind,
  filePath,
  onImportImageFile,
  onPassthroughScroll,
  refreshToken = 0,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
  variant = 'tile'
}: DocumentPaneProps) {
  if (fileKind === 'image') {
    return (
      <ImageDocumentPane
        filePath={filePath}
        refreshToken={refreshToken}
        showTileRefreshButton={showTileRefreshButton}
        showViewerRefreshButton={showViewerRefreshButton}
        variant={variant}
      />
    )
  }

  if (fileKind === 'note') {
    return (
      <NoteDocumentPane
        filePath={filePath}
        onImportImageFile={onImportImageFile}
        onPassthroughScroll={onPassthroughScroll}
        refreshToken={refreshToken}
        showTileRefreshButton={showTileRefreshButton}
        showViewerRefreshButton={showViewerRefreshButton}
        variant={variant}
      />
    )
  }

  return (
    <CodeDocumentPane
      filePath={filePath}
      onPassthroughScroll={onPassthroughScroll}
      refreshToken={refreshToken}
      showTileRefreshButton={showTileRefreshButton}
      showViewerRefreshButton={showViewerRefreshButton}
      variant={variant}
    />
  )
}

export const DocumentPane = memo(DocumentPaneComponent, (previous, next) => {
  return (
    previous.fileKind === next.fileKind &&
    previous.filePath === next.filePath &&
    previous.refreshToken === next.refreshToken &&
    previous.showTileRefreshButton === next.showTileRefreshButton &&
    previous.showViewerRefreshButton === next.showViewerRefreshButton &&
    previous.variant === next.variant
  )
})
