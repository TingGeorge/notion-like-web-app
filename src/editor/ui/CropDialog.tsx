/**
 * DATA-19: crop an image. Drag the frame's corners and edges, or the frame itself; with the keyboard,
 * the arrow keys move the frame and Shift + arrows resize it. 「完成」 draws the kept part (at most
 * 2560 px on its long edge, as an upload would be) and uploads it as a new attachment (the original
 * stays in the repo, DATA-20); the block then points at it, keeping its scale on the page. ⌘Z brings
 * the original back.
 */
import { useEffect, useRef, useState } from 'react'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { fitWithin } from '../../lib/data/assets'
import { schema } from '../../lib/schema'
import { t } from '../../strings'
import { Button, Modal, Spinner } from '../../ui/primitives'
import { CROP_HANDLES, dragCrop, isWholeImage, roundRect, widthAfterCrop, type CropHandle, type Rect } from '../crop'
import { useEditorUI, useUIState } from './shared'

/** The image at `pos` (the crop target is mapped through every transaction), or null. */
function imageAt(doc: PMNode, pos: number): PMNode | null {
  if (pos < 0 || pos >= doc.content.size) return null
  const node = doc.nodeAt(pos)
  return node?.type === schema.nodes.image ? node : null
}

/** How wide the image shows on the page, in CSS pixels. */
function shownWidth(view: EditorView, pos: number): number | null {
  const dom = view.nodeDOM(pos)
  const frame = dom instanceof HTMLElement ? dom.querySelector('.image-frame') : null
  return frame ? frame.getBoundingClientRect().width : null
}

function fileName(src: string): string {
  let last = src.split('/').pop() ?? ''
  try {
    last = decodeURIComponent(last)
  } catch {
    // A hand-written path with a stray `%`: use it as it is.
  }
  return `${last.replace(/\.[^.]*$/, '') || 'image'}-crop.png`
}

/** An upload error carries a message for the user (DATA-19 limits); anything else does not. */
class UploadError extends Error {}

export function CropDialog() {
  const { view, ctx } = useEditorUI()
  const ui = useUIState(ctx)
  const image = ui.crop ? imageAt(view.state.doc, ui.crop.pos) : null
  // The image went away (deleted here, or by a sync): close.
  useEffect(() => {
    if (ui.crop && !image) ctx.ui.set({ crop: null })
  }, [ctx, ui.crop, image])
  if (!ui.crop || !image) return null
  return <Cropper key={image.attrs.src as string} node={image} />
}

function Cropper({ node }: { node: PMNode }) {
  const { view, ctx } = useEditorUI()
  const src = node.attrs.src as string
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const drag = useRef<{ handle: CropHandle; x: number; y: number; start: Rect; scale: number } | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    let alive = true
    const direct = /^blob:/i.test(src)
    void (direct ? Promise.resolve(src) : ctx.assets.get(src)).then((u) => {
      if (!alive) return
      if (u) setUrl(u)
      else setFailed(true)
    })
    return () => {
      alive = false
    }
  }, [ctx, src])

  // Stable, so the dialog keeps its focus while busy; a click outside or Escape is ignored then.
  const close = () => {
    if (busyRef.current) return
    ctx.ui.set({ crop: null })
    view.focus()
  }

  const onLoad = () => {
    const img = imgRef.current
    if (!img || !img.naturalWidth) return
    const size = { w: img.naturalWidth, h: img.naturalHeight }
    setNatural(size)
    setRect({ x: 0, y: 0, ...size })
  }

  const startDrag = (handle: CropHandle) => (e: React.PointerEvent) => {
    if (!rect || !natural || !imgRef.current || busy) return
    e.preventDefault()
    e.stopPropagation()
    const scale = imgRef.current.getBoundingClientRect().width / natural.w
    drag.current = { handle, x: e.clientX, y: e.clientY, start: rect, scale }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !natural) return
    setRect(dragCrop(d.start, d.handle, (e.clientX - d.x) / d.scale, (e.clientY - d.y) / d.scale, natural))
  }
  const endDrag = () => {
    drag.current = null
  }

  // Keyboard: arrows move the frame by about 1% of the image (10% with Alt); Shift + arrows resize it.
  const onKey = (e: React.KeyboardEvent) => {
    if (!rect || !natural || busy) return
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (!dir) return
    e.preventDefault()
    const step = Math.max(1, Math.round(Math.max(natural.w, natural.h) * (e.altKey ? 0.1 : 0.01)))
    setRect(dragCrop(rect, e.shiftKey ? 'se' : 'move', dir[0] * step, dir[1] * step, natural))
  }

  const apply = async () => {
    const img = imgRef.current
    if (!img || !rect || !natural) return
    if (isWholeImage(rect, natural)) {
      close()
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const r = roundRect(rect, natural)
      const startPos = ctx.ui.getSnapshot().crop?.pos
      const shown = startPos === undefined ? null : shownWidth(view, startPos)
      // Scaled like an upload, so a huge photo does not exceed what a phone can draw.
      const out = fitWithin(r.w, r.h)
      const canvas = document.createElement('canvas')
      canvas.width = out.width
      canvas.height = out.height
      const g = canvas.getContext('2d')
      if (!g) throw new Error('no canvas')
      g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height)
      // Lossless here; the upload re-encodes it like any picture (DATA-19: JPEG unless transparent).
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('no blob')
      const result = await ctx
        .services()
        .uploadFile(new File([blob], fileName(src), { type: 'image/png' }))
        .catch((e: unknown) => {
          throw new UploadError(e instanceof Error && e.message ? e.message : t.editor.cropFailed)
        })
      // Only the same image, still there, in a page that can still be edited.
      const pos = ctx.ui.getSnapshot().crop?.pos
      const target = pos === undefined || view.isDestroyed ? null : imageAt(view.state.doc, pos)
      if (pos !== undefined && target && target.attrs.src === src && view.editable) {
        const current = target.attrs.width as number | null
        // Without a width, an image wider than the page shows narrower: keep that scale too.
        const base = current ?? (shown !== null && shown < natural.w - 1 ? Math.round(shown) : null)
        const width = widthAfterCrop(base, natural.w, r.w)
        view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...target.attrs, src: result.href, width }))
      }
      busyRef.current = false
      close()
    } catch (e) {
      busyRef.current = false
      setError(e instanceof UploadError ? e.message : t.editor.cropFailed)
      setBusy(false)
    }
  }

  // The frame and the dimmed outside, in percent of the shown image.
  const box =
    rect && natural
      ? { left: `${(rect.x / natural.w) * 100}%`, top: `${(rect.y / natural.h) * 100}%`, width: `${(rect.w / natural.w) * 100}%`, height: `${(rect.h / natural.h) * 100}%` }
      : null

  return (
    <Modal open onClose={close} title={t.editor.cropTitle} showTitle width={640} className="gn-crop-modal">
      <div className="gn-crop-stage" onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {url ? (
          <div className="gn-crop-canvas">
            <img ref={imgRef} src={url} alt={(node.attrs.alt as string) ?? ''} draggable={false} onLoad={onLoad} onError={() => setFailed(true)} />
            {box && (
              <div
                className="gn-crop-frame"
                style={box}
                role="group"
                tabIndex={0}
                aria-label={t.editor.cropFrame}
                onPointerDown={startDrag('move')}
                onKeyDown={onKey}
                data-testid="crop-frame"
              >
                {CROP_HANDLES.map((h) => (
                  <span key={h} className={`gn-crop-handle is-${h}`} onPointerDown={startDrag(h)} data-handle={h} aria-hidden="true" />
                ))}
              </div>
            )}
          </div>
        ) : failed ? (
          <p className="gn-crop-message">{t.editor.imageUnavailable}</p>
        ) : (
          <p className="gn-crop-message">
            <Spinner size={14} /> {t.common.loading}
          </p>
        )}
      </div>
      {rect && natural && (
        <p className="gn-crop-size">
          {Math.round(rect.w)} × {Math.round(rect.h)}
        </p>
      )}
      {error && (
        <p className="gn-crop-error" role="alert">
          {error}
        </p>
      )}
      <div className="gn-crop-actions">
        <Button variant="ghost" disabled={!natural || busy} onClick={() => natural && setRect({ x: 0, y: 0, ...natural })}>
          {t.editor.cropReset}
        </Button>
        <Button onClick={close} disabled={busy}>
          {t.common.cancel}
        </Button>
        <Button variant="primary" onClick={() => void apply()} loading={busy} disabled={!natural}>
          {t.common.done}
        </Button>
      </div>
    </Modal>
  )
}
