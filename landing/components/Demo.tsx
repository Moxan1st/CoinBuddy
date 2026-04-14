'use client'

import { useI18n } from '@/lib/i18n'

export default function Demo() {
  const { copy } = useI18n()

  return (
    <section id="demo" className="content-section demo-section">
      <div className="shell demo-grid">
        <div className="demo-copy-stack">
          <div className="section-heading compact">
            <p className="section-kicker">{copy.demo.eyebrow}</p>
            <h2>{copy.demo.title}</h2>
            <p>{copy.demo.body}</p>
          </div>
          <div className="demo-note-card">
            <div className="demo-note-icon">
              <img src="/CoinBuddy ICON 深色.png" alt="CoinBuddy mark" />
            </div>
            <div>
              <p className="demo-note-kicker">{copy.demo.noteKicker}</p>
              <p className="demo-note-body">{copy.demo.noteBody}</p>
            </div>
          </div>
        </div>

        <div className="demo-frame">
          <div className="demo-frame-bar">
            <span>{copy.demo.placeholderLabel}</span>
            <span>{copy.demo.placeholderHint}</span>
          </div>
          <div className="demo-placeholder">
            <div className="demo-shot" />
            <div className="demo-cat">
              <img src="/cats/行走.png" alt="CoinBuddy demo cat" className="pixel-cat" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
