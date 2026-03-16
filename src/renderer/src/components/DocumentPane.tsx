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

import type { FileKind, OfficeViewerBootstrap, TextFileDocument } from '@shared/types'
import { PdfPane } from './document-panes/PdfPane'
import { PresentationPane } from './document-panes/PresentationPane'
import { SpreadsheetPane } from './document-panes/SpreadsheetPane'
import { VideoPane } from './document-panes/VideoPane'
import {
  imageAltTextFromPath,
  imageFileCandidateFromPath,
  MarkdownImageExtension,
  normalizeMarkdownImageReferences,
  relativeImagePath
} from '../utils/markdownImages'
import {
  MarkdownListItem,
  MarkdownShortcutExtension,
  MarkdownTaskItem
} from '../utils/markdownShortcuts'

const COLLABORATOR_FILE_MIME = 'application/x-collaborator-file'

interface DocumentPaneProps {
  fileKind: FileKind
  filePath: string
  officeViewer?: OfficeViewerBootstrap | null
  onSetPresentationEmbedUrl?: (url: string | null) => void
  onImportImageFile?: (file: File) => Promise<{ name: string; path: string } | null>
  onRegisterNoteCopyActions?: (actions: MarkdownCopyActions | null) => void
  onPassthroughScroll?: (deltaX: number, deltaY: number) => void
  presentationEmbedUrl?: string | null
  refreshToken?: number
  showTileRefreshButton?: boolean
  showViewerRefreshButton?: boolean
  variant?: 'tile' | 'viewer'
}

type DocumentStatus = 'idle' | 'loading' | 'saving' | 'error'

interface SurfaceFrameProps {
  children: ReactNode
  fileKind: 'note' | 'code' | 'pdf'
  headerActions?: ReactNode
  onRefresh?: () => void
  showTileRefreshButton?: boolean
  showViewerRefreshButton?: boolean
  status: DocumentStatus
  variant: 'tile' | 'viewer'
}

export interface MarkdownCopyActions {
  copyFormatted: () => Promise<void>
  copyPlainText: () => Promise<void>
}

function SurfaceFrame({
  children,
  fileKind,
  headerActions,
  onRefresh,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
  status,
  variant
}: SurfaceFrameProps) {
  const statusLabel = status === 'saving' ? 'Saving' : 'Synced'
  const surfaceLabel =
    fileKind === 'note' ? 'Note Surface' : fileKind === 'pdf' ? 'PDF Surface' : 'Code Surface'

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
            {surfaceLabel}
          </div>
          <div className="flex items-center gap-2">
            {headerActions}
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

function cacheBustedFileUrl(fileUrl: string, version: number) {
  try {
    const nextUrl = new URL(fileUrl)
    nextUrl.searchParams.set('v', String(version))
    return nextUrl.toString()
  } catch {
    return fileUrl
  }
}

async function copyPlainTextToClipboard(text: string) {
  if (typeof window.collaborator.copyTextToClipboard === 'function') {
    await window.collaborator.copyTextToClipboard(text)
    return
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.top = '-9999px'
  textArea.style.opacity = '0'
  document.body.appendChild(textArea)
  textArea.select()
  textArea.setSelectionRange(0, text.length)

  const copied = document.execCommand('copy')
  document.body.removeChild(textArea)

  if (!copied) {
    throw new Error('The clipboard is unavailable.')
  }
}

async function copyRichTextToClipboard(html: string, text: string) {
  if (typeof window.collaborator.copyHtmlToClipboard === 'function') {
    await window.collaborator.copyHtmlToClipboard(html, text)
    return
  }

  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })
    ])
    return
  }

  const copyListener = (event: ClipboardEvent) => {
    event.preventDefault()
    event.clipboardData?.setData('text/html', html)
    event.clipboardData?.setData('text/plain', text)
  }

  document.addEventListener('copy', copyListener)
  const copied = document.execCommand('copy')
  document.removeEventListener('copy', copyListener)

  if (!copied) {
    await copyPlainTextToClipboard(text)
  }
}

function CopyTextIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.4]">
      <rect x="5" y="3.25" width="7.75" height="9" rx="1.8" />
      <path d="M3.5 11V5.5A1.75 1.75 0 0 1 5.25 3.75" />
      <path d="M7 1.75h4" />
    </svg>
  )
}

function FormattingIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.3]">
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.5" strokeDasharray="1.6 1.8" />
      <path d="M5.25 6h5.5M5.25 8.5h4.75M5.25 11h3.5" strokeLinecap="round" />
    </svg>
  )
}

function PlainTextIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.3]">
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.5" strokeDasharray="2 2.1" />
      <path d="M4.75 5.75h6.5M4.75 8h4.75M4.75 10.25h5.5" strokeLinecap="round" />
    </svg>
  )
}

export function MarkdownCopyMenu({
  copyActions,
  editor,
  variant = 'viewer'
}: {
  copyActions: MarkdownCopyActions | null
  editor?: TiptapEditor
  variant?: 'tile' | 'viewer'
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const isTile = variant === 'tile'
  const disabled = !copyActions && !editor

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || menuRef.current?.contains(event.target)) {
        return
      }

      setOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  function openMenu() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }

    if (!disabled) {
      setOpen(true)
    }
  }

  function scheduleClose() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
    }

    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
    }, 90)
  }

  async function handleCopyFormatted() {
    if (copyActions) {
      await copyActions.copyFormatted()
    } else if (editor) {
      const html = editor.getHTML()
      const text = editor.getText({ blockSeparator: '\n\n' }).trim()

      await copyRichTextToClipboard(html, text)
    }

    setOpen(false)
  }

  async function handleCopyPlainText() {
    if (copyActions) {
      await copyActions.copyPlainText()
    } else if (editor) {
      const text = editor.getText({ blockSeparator: '\n\n' }).trim()

      await copyPlainTextToClipboard(text)
    }

    setOpen(false)
  }

  return (
    <div
      ref={menuRef}
      className="relative"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={openMenu}
      onPointerLeave={scheduleClose}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        className={clsx(
          'inline-flex items-center gap-2 rounded-[999px] border border-[color:var(--line-strong)]',
          'bg-[var(--surface-0)] text-[var(--text-dim)] transition',
          isTile ? 'h-5 gap-1.5 px-1.5 py-0 text-[10px]' : 'px-2.5 py-1.5 text-[12px]',
          disabled
            ? 'cursor-default opacity-55'
            : 'hover:border-[color:var(--line-strong)] hover:bg-[var(--surface-1)] hover:text-[var(--text)]'
        )}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current)
          }
        }}
        title="Copy note text"
      >
        <span
          className={clsx(
            'flex min-w-5 items-center justify-center rounded-[6px] bg-[var(--surface-1)] px-1 font-bold uppercase text-[var(--text-faint)]',
            isTile ? 'h-3.5 min-w-3.5 rounded-[4px] px-0.5 text-[8px]' : 'h-5 text-[10px]'
          )}
        >
          F
        </span>
        <span className="inline-flex items-center">
          <CopyTextIcon />
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className={clsx(
            'absolute right-0 top-[calc(100%+10px)] z-30 w-[280px] rounded-[16px] border border-[color:var(--line)]',
            'bg-[color:var(--surface-overlay)] p-2 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur'
          )}
        >
          <button
            type="button"
            role="menuitem"
            className={clsx(
              'flex w-full items-start gap-3 rounded-[12px] px-3 py-3 text-left transition',
              'hover:bg-[var(--surface-1)]'
            )}
            onClick={() => void handleCopyFormatted()}
          >
            <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-[10px] bg-[var(--surface-1)] text-[var(--text-dim)]">
              <FormattingIcon />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[14px] font-semibold text-[var(--text)]">Copy with formatting</span>
              <span className="mt-0.5 text-[12px] leading-5 text-[var(--text-dim)]">
                Perfect for pasting into Notion, Google Docs or blogs
              </span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={clsx(
              'mt-1 flex w-full items-start gap-3 rounded-[12px] px-3 py-3 text-left transition',
              'hover:bg-[var(--surface-1)]'
            )}
            onClick={() => void handleCopyPlainText()}
          >
            <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-[10px] bg-[var(--surface-1)] text-[var(--text-dim)]">
              <PlainTextIcon />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[14px] font-semibold text-[var(--text)]">Copy as plain text</span>
              <span className="mt-0.5 text-[12px] leading-5 text-[var(--text-dim)]">
                Great for tweets, plain editors, or clean sharing
              </span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

function RichNoteEditor({
  filePath,
  initialContent,
  onDocumentChange,
  onImportImageFile,
  onRegisterNoteCopyActions,
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
  onRegisterNoteCopyActions?: (actions: MarkdownCopyActions | null) => void
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
        StarterKit.configure({
          listItem: false
        }),
        MarkdownListItem,
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

  useEffect(() => {
    if (!onRegisterNoteCopyActions) {
      return
    }

    if (!editor) {
      onRegisterNoteCopyActions(null)
      return
    }

    onRegisterNoteCopyActions({
      copyFormatted: async () => {
        const html = editor.getHTML()
        const text = editor.getText({ blockSeparator: '\n\n' }).trim()
        await copyRichTextToClipboard(html, text)
      },
      copyPlainText: async () => {
        const text = editor.getText({ blockSeparator: '\n\n' }).trim()
        await copyPlainTextToClipboard(text)
      }
    })

    return () => {
      onRegisterNoteCopyActions(null)
    }
  }, [editor, onRegisterNoteCopyActions])

  if (!editor) {
    return <LoadingPane variant={variant} />
  }

  return (
    <SurfaceFrame
      fileKind="note"
      headerActions={
        variant === 'viewer' ? <MarkdownCopyMenu copyActions={null} editor={editor} /> : null
      }
      onRefresh={onRefresh}
      showTileRefreshButton={showTileRefreshButton}
      showViewerRefreshButton={showViewerRefreshButton}
      status={status}
      variant={variant}
    >
      <div
        className="rich-note-editor relative min-h-0 flex-1"
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
  onRegisterNoteCopyActions,
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
      onRegisterNoteCopyActions={onRegisterNoteCopyActions}
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

function VideoDocumentPane({
  filePath,
  refreshToken = 0,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
  variant = 'tile'
}: Pick<
  DocumentPaneProps,
  'filePath' | 'refreshToken' | 'showTileRefreshButton' | 'showViewerRefreshButton' | 'variant'
>) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [status, setStatus] = useState<DocumentStatus>('loading')
  const fileChangeCount = useFileChangeSignal(filePath)

  useEffect(() => {
    setVideoUrl(null)
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
        const nextVideoUrl = await window.collaborator.fileUrl(filePath)

        if (!cancelled) {
          setVideoUrl(cacheBustedFileUrl(nextVideoUrl, fileChangeCount + reloadCount + refreshToken))
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

  if (!videoUrl || status === 'loading') {
    return <LoadingPane variant={variant} />
  }

  const dragPayload = JSON.stringify({
    fileKind: 'video',
    name: filePath.split(/[\\/]/).pop() ?? 'Video',
    path: filePath
  })

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
          title="Refresh video"
        >
          ↻
        </button>
      ) : null}
      <video
        key={`${fileChangeCount}:${reloadCount}`}
        src={videoUrl}
        controls
        preload="metadata"
        playsInline
        draggable
        className="h-full w-full bg-black/10 object-contain"
        onDragStart={(event) => {
          if (!event.dataTransfer) {
            return
          }

          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData(COLLABORATOR_FILE_MIME, dragPayload)
          event.dataTransfer.setData('text/plain', filePath)
        }}
      />
    </div>
  )
}

function PdfDocumentPane({
  filePath,
  refreshToken = 0,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
  variant = 'tile'
}: Pick<
  DocumentPaneProps,
  'filePath' | 'refreshToken' | 'showTileRefreshButton' | 'showViewerRefreshButton' | 'variant'
>) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [status, setStatus] = useState<DocumentStatus>('loading')
  const fileChangeCount = useFileChangeSignal(filePath)

  useEffect(() => {
    setPdfUrl(null)
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
        const nextPdfUrl = await window.collaborator.fileUrl(filePath)

        if (!cancelled) {
          setPdfUrl(cacheBustedFileUrl(nextPdfUrl, fileChangeCount + reloadCount + refreshToken))
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
  }, [filePath, fileChangeCount, reloadCount, refreshToken])

  if (status === 'error') {
    return <ErrorPane variant={variant} />
  }

  if (!pdfUrl || status === 'loading') {
    return <LoadingPane variant={variant} />
  }

  return (
    <SurfaceFrame
      fileKind="pdf"
      onRefresh={() => setReloadCount((current) => current + 1)}
      showTileRefreshButton={showTileRefreshButton}
      showViewerRefreshButton={showViewerRefreshButton}
      status={status}
      variant={variant}
    >
      <iframe
        key={`${pdfUrl}:${reloadCount}`}
        src={pdfUrl}
        title={filePath.split(/[\\/]/).pop() ?? 'PDF'}
        className="h-full w-full border-0 bg-white"
      />
    </SurfaceFrame>
  )
}

function DocumentPaneComponent({
  fileKind,
  filePath,
  officeViewer = null,
  onSetPresentationEmbedUrl,
  onImportImageFile,
  onRegisterNoteCopyActions,
  onPassthroughScroll,
  presentationEmbedUrl = null,
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

  if (fileKind === 'video') {
    return (
      <VideoPane
        filePath={filePath}
        refreshToken={refreshToken}
        showTileRefreshButton={showTileRefreshButton}
        showViewerRefreshButton={showViewerRefreshButton}
        variant={variant}
      />
    )
  }

  if (fileKind === 'pdf') {
    return (
      <PdfPane
        filePath={filePath}
        refreshToken={refreshToken}
        showTileRefreshButton={showTileRefreshButton}
        showViewerRefreshButton={showViewerRefreshButton}
        variant={variant}
      />
    )
  }

  if (fileKind === 'spreadsheet') {
    return (
      <SpreadsheetPane
        filePath={filePath}
        officeViewer={officeViewer}
        refreshToken={refreshToken}
        showTileRefreshButton={showTileRefreshButton}
        showViewerRefreshButton={showViewerRefreshButton}
        variant={variant}
      />
    )
  }

  if (fileKind === 'presentation') {
    return (
      <PresentationPane
        filePath={filePath}
        officeViewer={officeViewer}
        onSetPresentationEmbedUrl={onSetPresentationEmbedUrl}
        presentationEmbedUrl={presentationEmbedUrl}
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
        onRegisterNoteCopyActions={onRegisterNoteCopyActions}
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
