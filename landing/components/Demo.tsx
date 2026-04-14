'use client'

import Image from 'next/image'
import { useState } from 'react'
import { useI18n } from '@/lib/i18n'

export default function Demo() {
  const { copy, locale } = useI18n()
  const [activeScenario, setActiveScenario] = useState(0)
  const currentScenario = copy.hero.scenarios[activeScenario]

  return (
    <section id="demo" className="content-section demo-section">
      <div className="shell demo-grid">
        <div className="demo-highlights">
          <div className="highlight-grid">
            {copy.highlights.items.map((item) => (
              <article key={item.key} className="highlight-card">
                <div className="highlight-art">
                  <Image src={item.catSrc} alt={item.catAlt} width={180} height={180} className="pixel-cat" />
                </div>
                <div className="highlight-copy">
                  <p className="highlight-kicker">{item.eyebrow}</p>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="hero-panel">
          <div className="hero-panel-heading">
            <h2>
              <span className="coby-mark">
                <span className="coby-chunk">
                  Co
                  <span className="coby-tag">in</span>
                </span>
                <span className="coby-chunk">
                  b
                  <span className="coby-tag">udd</span>
                </span>
                y
              </span>
              <span className="coby-title-suffix">
                {locale === 'zh' ? '为您执行' : 'works for you'}
              </span>
            </h2>
            <p className="hero-panel-intro">{copy.hero.heroNote}</p>
          </div>
          <div className="hero-visual-grid">
            <div className="hero-chat-stack">
              <div className="scenario-card">
                <p className="scenario-title">{currentScenario.title}</p>
                <div className="scenario-messages">
                  {currentScenario.messages.map((message, index) => (
                    <div key={`${currentScenario.key}-${index}`} className={message.speaker === 'user' ? 'chat-card user' : 'chat-card agent'}>
                      <span className="chat-label">
                        {message.speaker === 'user' ? copy.hero.userLabel : copy.hero.agentLabel}
                      </span>
                      <p>{message.text}</p>
                      {message.ctaLabel ? <div className="chat-cta">{message.ctaLabel}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="hero-cats">
              <Image
                src="/cats/玩平板.png"
                alt="CoinBuddy thinking"
                width={340}
                height={380}
                priority
                className="pixel-cat hero-main-cat"
              />
            </div>
          </div>
          <div className="hero-panel-bottom">
            {copy.hero.statusChips.map((chip, index) => (
              <button
                type="button"
                key={chip}
                onClick={() => setActiveScenario(index)}
                className={activeScenario === index ? 'status-chip accent' : 'status-chip'}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
