/**
 * First-run setup and device linking (SETUP-1 to SETUP-10, LINK-3, LINK-4).
 *
 * The app shell mounts `<SetupFlow step={…} navigate={…} deps={…} />` for the hash route `#/setup/<step>`.
 * `step` is one of `welcome | add-to-home | connect | repo | sync | scan | code`; `null` means welcome.
 *
 * In-flow secrets (the validated token, the scanned payload) live only in this component's state. They never
 * go into the URL, into logs or into error messages (SEC-2). Reloading mid-flow restarts at the first screen
 * that does not need them.
 */
import { useEffect, useState } from 'react'
import * as realCrypto from '../../lib/link/crypto'
import { t } from '../../strings/zh-TW'
import { PairingCodeScreen } from '../link/PairingCodeScreen'
import { ScanScreen } from '../link/ScanScreen'
import { AddToHome } from './AddToHome'
import { ChooseRepo } from './ChooseRepo'
import { Connect, type ConnectResult } from './Connect'
import { WELCOME_PLACEHOLDER, type SetupDeps } from './deps'
import { FirstSync } from './FirstSync'
import { Welcome } from './Welcome'

export type SetupStep = 'welcome' | 'add-to-home' | 'connect' | 'repo' | 'sync' | 'scan' | 'code'

const STEPS: readonly string[] = ['welcome', 'add-to-home', 'connect', 'repo', 'sync', 'scan', 'code']

export interface SetupFlowProps {
  /** From the route; `null` or an unknown value means welcome. */
  step: string | null
  /** Go to `#/setup/<step>`. */
  navigate(step: SetupStep): void
  deps: SetupDeps
  /** Draw a fake Safari toolbar on the add-to-home screen (design harness only). */
  mockSafariToolbar?: boolean
}

export function SetupFlow({ step, navigate, deps, mockSafariToolbar }: SetupFlowProps) {
  const [connected, setConnected] = useState<ConnectResult | null>(null)
  const [payload, setPayload] = useState<string | null>(null)
  const [scanNotice, setScanNotice] = useState<string | undefined>()
  const [repoName, setRepoName] = useState('')
  const [safariAccepted, setSafariAccepted] = useState(deps.safariTabAccepted ?? false)

  let current: SetupStep = STEPS.includes(step ?? '') ? (step as SetupStep) : 'welcome'
  // SETUP-2: on iOS outside the home-screen app, show M16 first.
  if (current === 'welcome' && deps.isIOS && !deps.isStandalone && !safariAccepted) current = 'add-to-home'
  // Steps that need in-flow state fall back when it is gone (for example after a reload).
  const missing = (current === 'repo' && !connected) || (current === 'code' && !payload)
  const fallback: SetupStep = current === 'repo' ? 'connect' : 'scan'

  useEffect(() => {
    if (missing) navigate(fallback)
  }, [missing, fallback, navigate])

  const deviceName = deps.deviceName ?? (deps.isIOS ? t.link.deviceIphone : t.link.deviceGeneric)
  const linkCrypto = deps.linkCrypto ?? realCrypto
  const welcomePage = deps.welcomePage ?? WELCOME_PLACEHOLDER
  const now = deps.now ?? (() => new Date())

  if (missing) return null

  switch (current) {
    case 'add-to-home':
      return (
        <AddToHome
          mockToolbar={mockSafariToolbar}
          onContinueInSafari={() => {
            deps.acceptSafariTab()
            setSafariAccepted(true)
            navigate('welcome')
          }}
        />
      )
    case 'connect':
      return (
        <Connect
          createClient={deps.createClient}
          today={deps.today}
          deviceName={deps.isIOS ? deviceName : undefined}
          onConnected={(result) => {
            setConnected(result)
            navigate('repo')
          }}
        />
      )
    case 'repo':
      return (
        <ChooseRepo
          repos={connected!.repos}
          client={connected!.client}
          token={connected!.token}
          tokenExpiresOn={connected!.tokenExpiresOn}
          user={connected!.user}
          welcomePage={welcomePage}
          now={now}
          onBack={() => navigate('connect')}
          onReady={async (ws) => {
            await deps.onWorkspaceReady(ws)
            setRepoName(`${ws.owner}/${ws.repo}`)
            setConnected(null)
            navigate('sync')
          }}
        />
      )
    case 'sync':
      return (
        <FirstSync
          repoName={repoName}
          runInitialSync={deps.runInitialSync}
          onFinished={deps.onFinished}
          deviceName={deps.isIOS ? deviceName : undefined}
        />
      )
    case 'scan':
      return (
        <ScanScreen
          deviceName={deviceName}
          notice={scanNotice}
          onCancel={() => {
            setScanNotice(undefined)
            navigate('welcome')
          }}
          onPayload={(p) => {
            setScanNotice(undefined)
            setPayload(p)
            navigate('code')
          }}
        />
      )
    case 'code':
      return (
        <PairingCodeScreen
          payload={payload!}
          deps={{ createClient: deps.createClient, linkCrypto, welcomePage, now }}
          onCancel={() => {
            setPayload(null)
            navigate('scan')
          }}
          onDiscard={(message) => {
            setPayload(null)
            setScanNotice(message)
            navigate('scan')
          }}
          onReady={async (ws) => {
            await deps.onWorkspaceReady(ws)
            setRepoName(`${ws.owner}/${ws.repo}`)
            setPayload(null)
            navigate('sync')
          }}
        />
      )
    default:
      return <Welcome onStart={() => navigate('connect')} onLinkWithQr={() => navigate('scan')} />
  }
}
