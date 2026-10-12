/**
 * Boot: load the device config; without a workspace show setup (SETUP-1, SETUP-2), otherwise
 * start the sync session and show the desktop or iPhone layout.
 */
import { useCallback, useEffect, useState } from 'react'
import { isIOS, isStandalone } from '../lib/data/device'
import type { DeviceInfo, Workspace } from '../lib/types'
import { toast } from '../ui/toast'
import { Toaster } from '../ui/toast'
import { useIsMobile, useUi } from './hooks'
import { DesktopShell, MobileShell } from './layout/Shells'
import { OverlayHost } from './OverlayHost'
import { registerServiceWorker } from './pwa'
import { navigate, useRoute } from './router'
import { createClient, loadDevice, loadWorkspace, onNotice, saveWorkspace, session, startSession, updateUi } from './session'
import { SetupFlow } from './setup/SetupFlow'
import { useTheme } from './shortcuts'
import { runInitialSync } from './workspaceAdmin'

type Boot = { state: 'loading' } | { state: 'ready'; workspace: Workspace | null; device: DeviceInfo }

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' })
  const [ui] = useUi()
  useTheme(ui.theme)

  useEffect(() => {
    void (async () => {
      const [workspace, device] = await Promise.all([loadWorkspace(), loadDevice()])
      if (workspace) {
        const s = startSession(workspace, device)
        s.engine.start()
      }
      setBoot({ state: 'ready', workspace, device })
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
  const { workspace, device } = boot

  // SETUP-1: without a workspace the main UI is not reachable.
  useEffect(() => {
    if (!workspace && route.name !== 'setup') navigate({ name: 'setup', step: null }, { replace: true })
    if (workspace && !setupActive && route.name === 'setup') navigate({ name: 'home' }, { replace: true })
  }, [workspace, setupActive, route.name])

  const onWorkspaceReady = useCallback(
    async (ws: Workspace) => {
      await saveWorkspace(ws)
      startSession(ws, device)
    },
    [device],
  )

  if (!workspace || (setupActive && route.name === 'setup')) {
    return (
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
          today: () => new Date(),
          existingWorkspace: workspace,
        }}
      />
    )
  }

  return (
    <>
      {mobile ? <MobileShell workspace={workspace} /> : <DesktopShell workspace={workspace} />}
      <OverlayHost />
    </>
  )
}
