/** 同步衝突 (SYNC-6, D10 / M20): keep both (default), use this device's version, or the other's. */
import { diffComm } from 'node-diff3'
import { useState } from 'react'
import { splitPageFile } from '../../lib/markdown'
import type { ConflictChoice } from '../../lib/sync/engine'
import { t } from '../../strings/zh-TW'
import { Button, cx, Modal, Sheet } from '../../ui/primitives'
import { hhmm } from '../format'
import { useFile, useIsMobile, usePages } from '../hooks'
import { closeOverlay } from '../overlays'
import { session } from '../session'
import './dialogs.css'

/** Split two texts into segments, marking the parts that differ (by character). */
function diffSegments(a: string, b: string): { mine: [string, boolean][]; theirs: [string, boolean][] } {
  const mine: [string, boolean][] = []
  const theirs: [string, boolean][] = []
  for (const part of diffComm(Array.from(a), Array.from(b))) {
    if ('common' in part && part.common) {
      const s = part.common.join('')
      mine.push([s, false])
      theirs.push([s, false])
    } else if ('buffer1' in part) {
      if (part.buffer1.length) mine.push([part.buffer1.join(''), true])
      if (part.buffer2.length) theirs.push([part.buffer2.join(''), true])
    }
  }
  return { mine, theirs }
}

/** The changed region of the two bodies, with a little context, as plain text. */
function changedRegion(local: string, remote: string): { a: string; b: string } {
  const la = local.split('\n')
  const lb = remote.split('\n')
  let start = 0
  while (start < la.length && start < lb.length && la[start] === lb[start]) start++
  let endA = la.length - 1
  let endB = lb.length - 1
  while (endA >= start && endB >= start && la[endA] === lb[endB]) {
    endA--
    endB--
  }
  const clean = (lines: string[]) =>
    lines
      .join('\n')
      .replace(/^\s*([-*+]|\d+\.|>|#{1,3})\s+(\[[ x]\]\s+)?/gm, '')
      .trim()
  return { a: clean(la.slice(start, endA + 1)), b: clean(lb.slice(start, endB + 1)) }
}

function Segments({ segments }: { segments: [string, boolean][] }) {
  return (
    <>
      {segments.map(([text, changed], i) =>
        changed ? (
          <mark key={i} className="conflict-mark">
            {text}
          </mark>
        ) : (
          <span key={i}>{text}</span>
        ),
      )}
    </>
  )
}

export function ConflictDialog({ path }: { path: string }) {
  const file = useFile(path)
  const pages = usePages()
  const mobile = useIsMobile()
  const [busy, setBusy] = useState(false)
  const conflict = file?.conflict
  if (file === undefined) return null
  if (!conflict) {
    // SYNC-6: the conflict may resolve itself when another remote change arrives.
    closeOverlay()
    return null
  }
  const page = pages.find((p) => p.path === path)
  const title = page?.title ?? path
  const me = mobile ? t.conflict.thisPhone(session()?.device.name.split(' · ')[0] ?? '') : t.conflict.thisComputer
  const other = conflict.remoteDevice?.split(' · ')[0] ?? t.conflict.githubVersion
  const region = changedRegion(splitPageFile(conflict.localText).body, splitPageFile(conflict.remoteText).body)
  const { mine, theirs } = diffSegments(region.a, region.b)

  const choose = async (choice: ConflictChoice) => {
    setBusy(true)
    try {
      await session()?.engine.resolveConflict(path, choice)
      closeOverlay()
    } finally {
      setBusy(false)
    }
  }

  const versions = [
    { who: mobile ? me : t.conflict.thisComputer, at: conflict.localAt, segments: mine },
    { who: other, at: conflict.remoteAt, segments: theirs },
  ]
  const boxes = (
    <div className={cx('conflict-versions', mobile && 'is-mobile')}>
      {versions.map((v, i) => (
        <div key={i} className="conflict-version">
          <div className="conflict-who">
            {v.who}
            {v.at ? ` · ${hhmm(v.at)}` : ''}
          </div>
          <div className="conflict-text">
            <Segments segments={v.segments} />
          </div>
        </div>
      ))}
    </div>
  )
  const intro = (
    <p className="conflict-intro">
      {t.conflict.intro(other, mobile ? me : t.conflict.thisComputer)}
      <br />
      {t.conflict.intro2}
    </p>
  )

  if (mobile) {
    return (
      <Sheet open onClose={closeOverlay} title={t.conflict.title(title)} className="conflict-sheet">
        {intro}
        {boxes}
        <div className="conflict-actions is-mobile">
          <Button variant="primary" size="lg" block disabled={busy} onClick={() => void choose('keep-both')}>
            {t.conflict.keepBoth}
          </Button>
          <Button size="lg" block disabled={busy} onClick={() => void choose('mine')}>
            {t.conflict.useMine(me)}
          </Button>
          <Button size="lg" block disabled={busy} onClick={() => void choose('theirs')}>
            {t.conflict.useTheirs(other)}
          </Button>
        </div>
        <p className="conflict-footer">{t.conflict.footer}</p>
      </Sheet>
    )
  }
  return (
    <Modal open onClose={closeOverlay} title={t.conflict.title(title)} showTitle width={468} className="conflict-modal">
      {intro}
      {boxes}
      <div className="conflict-actions">
        {/* SYNC-6: 「兩個都保留」 is the default choice (focused, so Enter picks it). */}
        <Button disabled={busy} data-autofocus onClick={() => void choose('keep-both')}>
          {t.conflict.keepBoth}
        </Button>
        <Button disabled={busy} onClick={() => void choose('theirs')}>
          {t.conflict.useTheirs(other)}
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void choose('mine')}>
          {t.conflict.useMine(t.conflict.thisComputer)}
        </Button>
      </div>
      <p className="conflict-footer">{t.conflict.footer}</p>
    </Modal>
  )
}
