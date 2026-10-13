/** Small shared pieces of the setup screens: logo mark, header, step indicator. */
import type { ReactNode } from 'react'
import { Check, FileText } from 'lucide-react'
import { t } from '../../strings'
import { cx } from '../../ui/primitives'
import './setup.css'

export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span className={cx('logo-mark', className)} style={{ width: size, height: size, borderRadius: Math.round(size * 0.22) }} aria-hidden="true">
      <FileText size={Math.round(size * 0.5)} strokeWidth={1.75} />
    </span>
  )
}

/** The bar above steps 1 to 3 (D12): logo and name on the left, 說明 on the right. */
export function SetupHeader() {
  return (
    <header className="setup-header">
      <span className="setup-brand">
        <LogoMark size={24} />
        <span>{t.app.name}</span>
      </span>
      <a className="setup-help" href={t.setup.helpUrl} target="_blank" rel="noopener noreferrer">
        {t.common.help}
      </a>
    </header>
  )
}

/** Onboarding step indicator (Figma 20:654): 1 連結 GitHub — 2 選擇 repo — 3 開始使用. */
export function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="steps" aria-label={t.setup.stepsLabel}>
      {t.setup.steps.map((label, i) => {
        const n = i + 1
        const state = n < current ? 'done' : n === current ? 'current' : 'todo'
        return (
          <li key={label} className={cx('step', `is-${state}`)} aria-current={state === 'current' ? 'step' : undefined}>
            {i > 0 && <span className={cx('step-line', n <= current && 'is-on')} aria-hidden="true" />}
            <span className="step-dot" aria-hidden="true">
              {state === 'done' ? <Check size={13} strokeWidth={3} /> : n}
            </span>
            <span className="step-label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Header + step indicator + a centred column. `footer` holds the buttons: inline on desktop, a sticky bottom bar on iPhone. */
export function SetupPage({ step, children, footer }: { step: 1 | 2 | 3; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="setup-page">
      <SetupHeader />
      <div className="setup-scroll">
        <div className="setup-col">
          <StepIndicator current={step} />
          {children}
          {footer && <div className="setup-footer">{footer}</div>}
        </div>
      </div>
    </div>
  )
}
