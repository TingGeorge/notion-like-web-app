/**
 * LINK-3 / LINK-4 / M15: scan the QR code shown on the other device, or paste the setup code.
 * Frames are decoded with jsQR about five times a second. The camera stops on unmount.
 */
import { useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import jsQR from 'jsqr'
import { PAYLOAD_PREFIX } from '../../lib/link/crypto'
import { t } from '../../strings'
import { Button } from '../../ui/primitives'
import './link.css'

/** LINK-3: only `ghnotes:1:` payloads are accepted. */
export function isPayloadText(text: string): boolean {
  return text.trim().startsWith(PAYLOAD_PREFIX)
}

export interface ScanScreenProps {
  /** A `ghnotes:1:…` payload was scanned or pasted. */
  onPayload(payload: string): void
  onCancel(): void
  /** For 「設定只會存在這台 …」. */
  deviceName: string
  /** A message to show first, for example after three wrong pairing codes. */
  notice?: string
  /** Start in paste mode (no camera). */
  startWithPaste?: boolean
}

type CameraState = 'starting' | 'live' | 'unavailable'

const SCAN_INTERVAL_MS = 200

export function ScanScreen({ onPayload, onCancel, deviceName, notice, startWithPaste }: ScanScreenProps) {
  const [mode, setMode] = useState<'scan' | 'paste'>(startWithPaste ? 'paste' : 'scan')
  const [camera, setCamera] = useState<CameraState>('starting')
  const [error, setError] = useState<string | null>(notice ?? null)
  const [pasted, setPasted] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const onPayloadRef = useRef(onPayload)
  useEffect(() => {
    onPayloadRef.current = onPayload
  })

  // Camera and decode loop (only in scan mode).
  useEffect(() => {
    if (mode !== 'scan') return
    let stopped = false
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    const stop = () => {
      stopped = true
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      const v = videoRef.current
      if (v) v.srcObject = null
    }

    const start = async () => {
      setCamera('starting')
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera('unavailable')
        return
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (stopped) {
          s.getTracks().forEach((track) => track.stop())
          return
        }
        stream = s
        const v = videoRef.current
        if (!v) return
        v.srcObject = s
        v.setAttribute('playsinline', 'true')
        await v.play().catch(() => undefined)
        setCamera('live')
        timer = setInterval(() => {
          if (!ctx || v.readyState < 2 || v.videoWidth === 0) return
          const scale = Math.min(1, 720 / v.videoWidth)
          const w = Math.round(v.videoWidth * scale)
          const h = Math.round(v.videoHeight * scale)
          canvas.width = w
          canvas.height = h
          ctx.drawImage(v, 0, 0, w, h)
          const img = ctx.getImageData(0, 0, w, h)
          const hit = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
          if (!hit) return
          if (isPayloadText(hit.data)) {
            stop()
            onPayloadRef.current(hit.data.trim())
          } else {
            setError(t.link.notOurQr)
          }
        }, SCAN_INTERVAL_MS)
      } catch {
        if (!stopped) setCamera('unavailable')
      }
    }
    void start()
    return stop
  }, [mode])

  const submitPaste = () => {
    if (isPayloadText(pasted)) onPayload(pasted.trim())
    else setError(t.link.notOurQr)
  }

  const showPasteHint = mode === 'scan' && camera === 'unavailable'

  return (
    <div className="scan-screen">
      <header className="scan-top">
        <button type="button" className="scan-cancel" onClick={onCancel}>
          {t.common.cancel}
        </button>
        <h1>{t.link.scanTitle}</h1>
      </header>

      {mode === 'scan' ? (
        <>
          <div className="scan-center">
            <div className="scan-frame">
              <video ref={videoRef} className="scan-video" muted playsInline aria-hidden="true" />
              <i className="corner tl" />
              <i className="corner tr" />
              <i className="corner bl" />
              <i className="corner br" />
            </div>
            <h2 className="scan-heading">{t.link.scanHeading}</h2>
            <p className="scan-hint">{t.link.scanHint}</p>
            {camera === 'starting' && !error && <p className="scan-status">{t.link.cameraStarting}</p>}
            {showPasteHint && <p className="scan-status is-error">{t.link.cameraDenied}</p>}
            {error && (
              <p className="scan-status is-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="scan-bottom">
            <button
              type="button"
              className="scan-link"
              onClick={() => {
                setError(null)
                setMode('paste')
              }}
            >
              {t.link.usePasteCode}
            </button>
            <div className="scan-chip">
              <Lock size={12} aria-hidden="true" />
              {t.link.storedOnlyHere(deviceName)}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="scan-center scan-paste">
            <h2 className="scan-heading">{t.link.pasteLabel}</h2>
            <p className="scan-hint">{t.link.pasteHint}</p>
            <textarea
              className="scan-textarea"
              value={pasted}
              placeholder={t.link.pastePlaceholder}
              aria-label={t.link.pasteLabel}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              rows={5}
              onChange={(e) => {
                setPasted(e.target.value)
                setError(null)
              }}
              autoFocus
            />
            {error && (
              <p className="scan-status is-error" role="alert">
                {error}
              </p>
            )}
            <Button variant="primary" size="lg" block disabled={pasted.trim() === ''} onClick={submitPaste}>
              {t.link.pasteContinue}
            </Button>
          </div>
          <div className="scan-bottom">
            <button
              type="button"
              className="scan-link"
              onClick={() => {
                setError(null)
                setMode('scan')
              }}
            >
              {t.link.useCamera}
            </button>
            <div className="scan-chip">
              <Lock size={12} aria-hidden="true" />
              {t.link.storedOnlyHere(deviceName)}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
