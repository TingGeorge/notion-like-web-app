/** D01 / M01 (SETUP-1). */
import { Link2 } from 'lucide-react'
import { t } from '../../strings'
import { Button } from '../../ui/primitives'
import { LogoMark } from './parts'
import './setup.css'

export interface WelcomeProps {
  onStart(): void
  onLinkWithQr(): void
}

export function Welcome({ onStart, onLinkWithQr }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <LogoMark size={56} className="welcome-logo" />
        <h1 className="welcome-title">{t.app.name}</h1>
        <p className="welcome-tagline welcome-tagline-desktop">{t.app.tagline}</p>
        <p className="welcome-tagline welcome-tagline-phone">
          {t.app.taglineMobile.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </p>
      </div>
      <div className="welcome-actions">
        <Button variant="primary" size="lg" block onClick={onStart}>
          {t.setup.start}
        </Button>
        <Button variant="secondary" size="lg" block onClick={onLinkWithQr}>
          {t.setup.linkWithQr}
        </Button>
        <p className="welcome-small">
          {t.app.noServer.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </p>
      </div>
      <footer className="welcome-footer">
        <Link2 size={12} aria-hidden="true" />
        <span>{t.app.openSource}</span>
        <span aria-hidden="true">•</span>
        <a href={`https://${t.app.repoUrl}`} target="_blank" rel="noopener noreferrer">
          {t.app.repoUrl}
        </a>
      </footer>
    </div>
  )
}
