/**
 * Boot: load the device config; without a workspace show setup (SETUP-1, SETUP-2), otherwise
 * start the sync session and show the desktop or iPhone layout.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { deviceName, isIOS, isStandalone } from '../lib/data/device'
import { WELCOME_PAGE_BODY } from '../lib/data/templates'
import { db } from '../lib/store/db'
import type { DeviceInfo, Workspace } from '../lib/types'
import { toast } from '../ui/toast'
import { Toaster } from '../ui/toast'
import { useIsMobile, useUi } from './hooks'
import { DesktopShell, MobileShell } from './layout/Shells'
import { OverlayHost } from './OverlayHost'
import { registerServiceWorker } from './pwa'
import { navigate, useRoute } from './router'
import { deleteLeftoverLinkGist } from './link/linkGist'
import { createClient, loadDevice, loadUi, loadWorkspace, onNotice, preloadSearch, saveWorkspace, session, startSession, updateUi } from './session'
import { useTheme } from './shortcuts'
import { runInitialSync } from './workspaceAdmin'

// First run only: keeps the camera/QR code out of the main bundle.
const SetupFlow = lazy(() => import('./setup/SetupFlow').then((m) => ({ default: m.SetupFlow })))

type Resume = { token: string; tokenExpiresOn: string | null }
type Boot = { state: 'loading' } | { state: 'ready'; workspace: Workspace | null; device: DeviceInfo; resume: Resume | null; safariAccepted: boolean }

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' })
  const [ui] = useUi()
  useTheme(ui.theme)

  useEffect(() => {
    void (async () => {
      const [workspace, device, resumeRow, prefs] = await Promise.all([loadWorkspace(), loadDevice(), db().config.get('resume'), loadUi()])
      if (workspace) {
        const s = startSession(workspace, device)
        s.engine.start()
        preloadSearch()
        const gists = createClient(workspace.token)
        const cleanUp = () =>
          void deleteLeftoverLinkGist(gists).then((wait) => {
            if (wait !== null) setTimeout(cleanUp, wait)
          })
        cleanUp()
      }
      const resume = resumeRow && resumeRow.key === 'resume' ? resumeRow.value : null
      setBoot({ state: 'ready', workspace, device, resume, safariAccepted: prefs.safariTabModeAccepted ?? false })
    })()
    void registerServiceWorker()
    return onNotice((message) => toast(message, { duration: 6000 }))
  }, [])

  if (boot.state === 'loading') return <div className="boot" />
  return (
    <>
      <Main boot={boot} onWorkspace={(workspace) => setBoot({ ...boot, workspace })} />
      <Toaster />
    </>
  )
}

function Main({ boot, onWorkspace }: { boot: Extract<Boot, { state: 'ready' }>; onWorkspace: (ws: Workspace) => void }) {
  const route = useRoute()
  const mobile = useIsMobile()
  const [setupActive, setSetupActive] = useState(!boot.workspace)
  const { workspace, device, resume } = boot

  // SETUP-1: without a workspace the main UI is not reachable.
  useEffect(() => {
    if (!workspace && route.name !== 'setup') navigate({ name: 'setup', step: null }, { replace: true })
    if (workspace && !setupActive && route.name === 'setup') navigate({ name: 'home' }, { replace: true })
  }, [workspace, setupActive, route.name])

  const onWorkspaceReady = useCallback(
    async (ws: Workspace) => {
      await saveWorkspace(ws)
      await db().config.delete('resume')
      startSession(ws, device)
    },
    [device],
  )

  if (!workspace || (setupActive && route.name === 'setup')) {
    return (
      <Suspense fallback={<div className="boot" />}>
        <SetupFlow
          step={route.name === 'setup' ? route.step : null}
          navigate={(step) => navigate({ name: 'setup', step })}
          deps={{
            createClient,
            onWorkspaceReady,
            runInitialSync,
            onFinished: () => {
              const s = session()
              if (!s) return
              s.engine.start()
              setSetupActive(false)
              onWorkspace(s.workspace)
              navigate({ name: 'home' }, { replace: true })
            },
            isIOS: isIOS(),
            isStandalone: isStandalone(),
            acceptSafariTab: () => void updateUi({ safariTabModeAccepted: true }),
            safariTabAccepted: boot.safariAccepted,
            today: () => new Date(),
            welcomePage: WELCOME_PAGE_BODY,
            deviceName: deviceName().split(' · ')[0],
            resume,
          }}
        />
      </Suspense>
    )
  }

  return (
    <>
      {mobile ? <MobileShell workspace={workspace} /> : <DesktopShell workspace={workspace} />}
      <OverlayHost />
    </>
  )
}
