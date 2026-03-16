import { useEffect, useMemo, useRef, useState } from 'react'

import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'

import {
  cacheBustedFileUrl,
  ErrorPane,
  FileViewerSurface,
  LoadingPane,
  useFileChangeSignal,
  type ViewerVariant
} from './FileViewerSurface'

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()

type ScaleMode = 'fit-width' | 'custom'

interface PdfPaneProps {
  filePath?: string
  refreshToken?: number
  showTileRefreshButton?: boolean
  showViewerRefreshButton?: boolean
  sourceUrl?: string
  title?: string
  variant?: ViewerVariant
}

interface PageLayout {
  height: number
  pageNumber: number
  width: number
}

export function PdfPane({
  filePath,
  refreshToken = 0,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
  sourceUrl,
  title,
  variant = 'tile'
}: PdfPaneProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(sourceUrl ?? null)
  const [reloadCount, setReloadCount] = useState(0)
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading')
  const [renderMode, setRenderMode] = useState<'pdfjs' | 'iframe'>('pdfjs')
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [pageLayouts, setPageLayouts] = useState<PageLayout[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fit-width')
  const [customScale, setCustomScale] = useState(1)
  const [containerWidth, setContainerWidth] = useState(0)
  const fileChangeCount = useFileChangeSignal(filePath ?? sourceUrl ?? 'remote-pdf')
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map())
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  useEffect(() => {
    if (!sourceUrl) {
      setPdfUrl(null)
    }
    setRenderMode('pdfjs')
    setStatus('loading')
    setPdfDocument(null)
    setPageLayouts([])
  }, [filePath, sourceUrl])

  useEffect(() => {
    if (refreshToken > 0) {
      setReloadCount((current) => current + 1)
    }
  }, [refreshToken])

  useEffect(() => {
    if (sourceUrl) {
      setPdfUrl(cacheBustedFileUrl(sourceUrl, refreshToken + reloadCount))
      setStatus('idle')
      return
    }

    if (!filePath) {
      setStatus('error')
      return
    }

    const localFilePath = filePath
    let cancelled = false

    async function load() {
      try {
        const nextPdfUrl = await window.collaborator.previewFileUrl(localFilePath)

        if (!cancelled) {
          setPdfUrl(cacheBustedFileUrl(nextPdfUrl, fileChangeCount + reloadCount + refreshToken))
          setStatus('idle')
        }
      } catch {
        try {
          const fallbackFileUrl = await window.collaborator.fileUrl(localFilePath)

          if (!cancelled) {
            setPdfUrl(cacheBustedFileUrl(fallbackFileUrl, fileChangeCount + reloadCount + refreshToken))
            setRenderMode('iframe')
            setStatus('idle')
          }
        } catch {
          if (!cancelled) {
            setStatus('error')
          }
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [fileChangeCount, filePath, refreshToken, reloadCount, sourceUrl])

  useEffect(() => {
    const element = scrollContainerRef.current

    if (!element) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]

      if (entry) {
        setContainerWidth(entry.contentRect.width)
      }
    })

    observer.observe(element)
    setContainerWidth(element.clientWidth)

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (renderMode !== 'pdfjs') {
      return
    }

    if (!pdfUrl || status !== 'idle') {
      return
    }

    let cancelled = false
    const loadingTask = getDocument(pdfUrl)

    void loadingTask.promise
      .then((documentProxy) => {
        if (cancelled) {
          void documentProxy.destroy()
          return
        }

        setPdfDocument(documentProxy)
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('PDF.js load failed, falling back to iframe viewer.', error)
          setRenderMode('iframe')
          setPdfDocument(null)
        }
      })

    return () => {
      cancelled = true
      void loadingTask.destroy()
      setPdfDocument((currentDocument) => {
        if (currentDocument) {
          void currentDocument.destroy()
        }

        return null
      })
    }
  }, [pdfUrl, renderMode, status])

  const resolvedScale = useMemo(() => {
    if (scaleMode === 'custom') {
      return customScale
    }

    if (containerWidth <= 0) {
      return 1
    }

    return Math.max((containerWidth - 48) / 816, 0.45)
  }, [containerWidth, customScale, scaleMode])

  useEffect(() => {
    if (!pdfDocument) {
      return
    }

    const documentProxy = pdfDocument
    let cancelled = false

    async function loadLayouts() {
      const nextLayouts: PageLayout[] = []

      for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
        const page = await documentProxy.getPage(pageNumber)
        const viewport = page.getViewport({ scale: resolvedScale })

        nextLayouts.push({
          height: viewport.height,
          pageNumber,
          width: viewport.width
        })
      }

      if (!cancelled) {
        setPageLayouts(nextLayouts)
        setCurrentPage((current) => Math.min(Math.max(current, 1), nextLayouts.length || 1))
      }
    }

    void loadLayouts().catch(() => {
      if (!cancelled) {
        setRenderMode('iframe')
      }
    })

    return () => {
      cancelled = true
    }
  }, [pdfDocument, resolvedScale])

  useEffect(() => {
    if (!pdfDocument || pageLayouts.length === 0) {
      return
    }

    const documentProxy = pdfDocument
    let cancelled = false
    const renderTasks: Array<{ cancel?: () => void }> = []

    async function renderPages() {
      for (const layout of pageLayouts) {
        const canvas = canvasRefs.current.get(layout.pageNumber)

        if (!canvas) {
          continue
        }

        const page = await documentProxy.getPage(layout.pageNumber)
        const viewport = page.getViewport({ scale: resolvedScale })
        const context = canvas.getContext('2d')

        if (!context) {
          continue
        }

        const outputScale = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`

        const renderTask = page.render({
          canvas,
          canvasContext: context,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          viewport
        })

        renderTasks.push(renderTask)

        await renderTask.promise

        if (cancelled) {
          return
        }
      }
    }

    void renderPages().catch(() => {
      if (!cancelled) {
        setRenderMode('iframe')
      }
    })

    return () => {
      cancelled = true

      for (const task of renderTasks) {
        task.cancel?.()
      }
    }
  }, [pageLayouts, pdfDocument, resolvedScale])

  useEffect(() => {
    const container = scrollContainerRef.current

    if (!container || pageLayouts.length === 0) {
      return
    }

    const updateCurrentPage = () => {
      const containerTop = container.getBoundingClientRect().top
      let bestPage = 1
      let bestDistance = Number.POSITIVE_INFINITY

      for (const layout of pageLayouts) {
        const element = pageRefs.current.get(layout.pageNumber)

        if (!element) {
          continue
        }

        const rect = element.getBoundingClientRect()
        const distance = Math.abs(rect.top - containerTop - 16)

        if (distance < bestDistance) {
          bestDistance = distance
          bestPage = layout.pageNumber
        }
      }

      setCurrentPage(bestPage)
    }

    updateCurrentPage()
    container.addEventListener('scroll', updateCurrentPage, { passive: true })

    return () => {
      container.removeEventListener('scroll', updateCurrentPage)
    }
  }, [pageLayouts])

  const zoomLabel = useMemo(() => {
    if (scaleMode === 'fit-width') {
      return 'Fit width'
    }

    return `${Math.round(customScale * 100)}%`
  }, [customScale, scaleMode])

  if (status === 'error') {
    return (
      <ErrorPane
        message="This PDF could not be rendered. Remote PDFs may still be blocked by CORS, in which case the embed viewer will fall back to an iframe."
        variant={variant}
      />
    )
  }

  if (!pdfUrl || status === 'loading') {
    return <LoadingPane variant={variant} />
  }

  if (renderMode === 'iframe' || !pdfDocument) {
    return (
      <FileViewerSurface
        label="PDF Surface"
        onRefresh={() => setReloadCount((current) => current + 1)}
        showTileRefreshButton={showTileRefreshButton}
        showViewerRefreshButton={showViewerRefreshButton}
        statusLabel="Browser viewer"
        variant={variant}
      >
        <iframe
          key={`${pdfUrl}:${reloadCount}:iframe`}
          src={pdfUrl}
          title={title ?? filePath?.split(/[\\/]/).pop() ?? 'PDF'}
          className="h-full w-full border-0 bg-white"
        />
      </FileViewerSurface>
    )
  }

  return (
    <FileViewerSurface
      label="PDF Surface"
      onRefresh={() => setReloadCount((current) => current + 1)}
      showTileRefreshButton={showTileRefreshButton}
      showViewerRefreshButton={showViewerRefreshButton}
      statusLabel={pageLayouts.length > 0 ? `${currentPage}/${pageLayouts.length}` : 'Loading'}
      variant={variant}
    >
      <div className="relative flex min-h-0 flex-1 flex-col bg-white">
        <div className="absolute left-3 top-3 z-20 flex items-center gap-1 rounded-[4px] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] p-1 text-[11px] text-[var(--text-dim)] shadow-[0_8px_20px_rgba(15,23,42,0.12)] backdrop-blur">
          <button
            className="rounded-[4px] px-2 py-1 transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            onClick={() => {
              setScaleMode('custom')
              setCustomScale((current) => Math.max(0.45, Number((current - 0.1).toFixed(2))))
            }}
            title="Zoom out"
          >
            −
          </button>
          <button
            className="rounded-[4px] px-2 py-1 transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            onClick={() => setScaleMode('fit-width')}
            title="Fit width"
          >
            {zoomLabel}
          </button>
          <button
            className="rounded-[4px] px-2 py-1 transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            onClick={() => {
              setScaleMode('custom')
              setCustomScale((current) => Math.min(3, Number((current + 0.1).toFixed(2))))
            }}
            title="Zoom in"
          >
            +
          </button>
        </div>
        <div
          ref={scrollContainerRef}
          className="min-h-0 flex-1 overflow-auto bg-[#f3f1ea] px-4 py-6"
          data-scroll-lock="true"
        >
          <div className="mx-auto flex max-w-full flex-col gap-5">
            {pageLayouts.map((layout) => (
              <div
                key={layout.pageNumber}
                ref={(element) => {
                  if (element) {
                    pageRefs.current.set(layout.pageNumber, element)
                  } else {
                    pageRefs.current.delete(layout.pageNumber)
                  }
                }}
                className="relative mx-auto rounded-[6px] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
                style={{ width: `${layout.width}px` }}
              >
                <div className="absolute right-3 top-3 rounded-[4px] bg-black/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                  {title ?? filePath?.split(/[\\/]/).pop() ?? 'PDF'} · {layout.pageNumber}
                </div>
                <canvas
                  ref={(element) => {
                    if (element) {
                      canvasRefs.current.set(layout.pageNumber, element)
                    } else {
                      canvasRefs.current.delete(layout.pageNumber)
                    }
                  }}
                  className="block rounded-[6px]"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </FileViewerSurface>
  )
}
