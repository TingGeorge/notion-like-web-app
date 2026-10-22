/**
 * DATA-19: crop an image. Drag the frame's corners and edges, or the frame itself. 「完成」 draws the
 * kept part at full resolution and uploads it as a new attachment (the original stays in the repo,
 * DATA-20); the block then points at it, keeping its scale on the page. ⌘Z brings the original back.
 */
import { useEffect, useRef, useState } from 'react'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '../../lib/schema'
import { t } from '../../strings'
import { Button, Modal, Spinner } from '../../ui/primitives'
import { CROP_HANDLES, dragCrop, isWholeImage, roundRect, widthAfterCrop, type CropHandle, type Rect } from '../crop'
import { useEditorUI, useUIState } from './shared'

/** The image at `pos`, or the first image with the same `src` if the document moved under the dialog. */
function findImage(doc: PMNode, pos: number, src: string | null): { pos: number; node: PMNode } | null {
  const at = doc.nodeAt(pos)
  if (at?.type === schema.nodes.image && (src === null || at.attrs.src === src)) return { pos, node: at }
  if (src === null) return null
  let found: { pos: number; node: PMNode } | null = null
  doc.descendants((node, p) => {
    if (found) return false
    if (node.type === schema.nodes.image && node.attrs.src === src) found = { pos: p, node }
    return !found
  })
  return found
}

function fileName(src: string): string {
  const last = decodeURIComponent(src.split('/').pop() ?? '').replace(/\.[^.]*$/, '')
  return `${last || 'image'}-crop.png`
}

export function CropDialog() {
  const { view, ctx } = useEditorUI()
  const ui = useUIState(ctx)
  if (!ui.crop) return null
  const image = findImage(view.state.doc, ui.crop.pos, null)
  if (!image) return null
  return <Cropper key={`${ui.crop.pos}:${image.node.attrs.src as string}`} pos={image.pos} node={image.node} />
}

function Cropper({ pos, node }: { pos: number; node: PMNode }) {
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

  const close = () => {
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

  const apply = async () => {
    const img = imgRef.current
    if (!img || !rect || !natural) return
    if (isWholeImage(rect, natural)) {
      close()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = roundRect(rect, natural)
      const canvas = document.createElement('canvas')
      canvas.width = r.w
      canvas.height = r.h
      const g = canvas.getContext('2d')
      if (!g) throw new Error(t.editor.cropFailed)
      g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
      // Lossless here; the upload re-encodes it like any picture (DATA-19: JPEG unless transparent).
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error(t.editor.cropFailed)
      const result = await ctx.services().uploadFile(new File([blob], fileName(src), { type: 'image/png' }))
      if (view.isDestroyed) return
      const target = findImage(view.state.doc, pos, src)
      if (target) {
        const width = widthAfterCrop(target.node.attrs.width as number | null, natural.w, r.w)
        view.dispatch(view.state.tr.setNodeMarkup(target.pos, null, { ...target.node.attrs, src: result.href, width }))
      }
      close()
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t.editor.cropFailed)
      setBusy(false)
    }
  }

  // The frame and the dimmed outside, in percent of the shown image.
  const box =
    rect && natural
      ? { left: `${(rect.x / natural.w) * 100}%`, top: `${(rect.y / natural.h) * 100}%`, width: `${(rect.w / natural.w) * 100}%`, height: `${(rect.h / natural.h) * 100}%` }
      : null

  return (
    <Modal open onClose={busy ? undefined : close} title={t.editor.cropTitle} showTitle width={640} className="gn-crop-modal">
      <div className="gn-crop-stage" onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {url ? (
          <div className="gn-crop-canvas">
            <img ref={imgRef} src={url} alt={(node.attrs.alt as string) ?? ''} draggable={false} onLoad={onLoad} onError={() => setFailed(true)} />
            {box && (
              <div className="gn-crop-frame" style={box} onPointerDown={startDrag('move')} data-testid="crop-frame">
                {CROP_HANDLES.map((h) => (
                  <span key={h} className={`gn-crop-handle is-${h}`} onPointerDown={startDrag(h)} data-handle={h} />
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
        <p className="gn-crop-size" aria-live="polite">
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
