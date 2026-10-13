/** M16 (SETUP-2): iOS in a Safari tab. Explains 加入主畫面 and points at Safari's share button. */
import { FileText, ChevronLeft, ChevronRight, Copy, Share } from 'lucide-react'
import { t } from '../../strings'
import { Button } from '../../ui/primitives'
import { LogoMark } from './parts'
import './setup.css'

export interface AddToHomeProps {
  /** 「仍要在 Safari 使用」: remember the choice and continue to the welcome screen. */
  onContinueInSafari(): void
  /** Draw a fake Safari toolbar under the bubble. Only for the design harness: the real toolbar is Safari's own. */
  mockToolbar?: boolean
}

export function AddToHome({ onContinueInSafari, mockToolbar }: AddToHomeProps) {
  return (
    <div className="a2h">
      <div className="a2h-main">
        <LogoMark size={56} />
        <h1 className="a2h-title">{t.setup.addToHomeTitle}</h1>
        <p className="a2h-intro">{t.setup.addToHomeIntro}</p>
        <ol className="a2h-steps">
          {t.setup.addToHomeSteps.map((text, i) => (
            <li key={text}>
              <span className="a2h-num" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                {text.includes('，') ? (
                  <>
                    {text.slice(0, text.indexOf('，') + 1)}
                    <br />
                    {text.slice(text.indexOf('，') + 1)}
                  </>
                ) : (
                  text
                )}
                {i === 0 && <Share size={16} className="a2h-share-icon" aria-hidden="true" />}
              </span>
            </li>
          ))}
        </ol>
        <Button variant="ghost" className="a2h-continue" onClick={onContinueInSafari}>
          {t.setup.continueInSafari}
        </Button>
      </div>
      <div className={mockToolbar ? 'a2h-bar is-mock' : 'a2h-bar'} aria-hidden="true">
        <div className="a2h-bubble">{t.setup.tapHere}</div>
        {mockToolbar && (
          <div className="a2h-toolbar">
            <ChevronLeft size={22} />
            <ChevronRight size={22} />
            <span className="a2h-toolbar-share">
              <Share size={22} />
            </span>
            <FileText size={22} />
            <Copy size={22} />
          </div>
        )}
      </div>
    </div>
  )
}
