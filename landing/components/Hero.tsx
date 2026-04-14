'use client'

import Image from 'next/image'
import { useState } from 'react'
import { useI18n } from '@/lib/i18n'

export default function Hero() {
  const { copy, locale } = useI18n()
  const [activeScenario, setActiveScenario] = useState(0)
  const currentScenario = copy.hero.scenarios[activeScenario]

  return (
    <section className="hero-section">
      <div className="shell hero-grid">
        <div className="hero-copy">
          <div className="hero-title-wrap">
            <h1 className="hero-title-text">{copy.hero.title}</h1>
          </div>

          <div className="hero-speech">
            <p className="hero-subtitle">{copy.hero.subtitle}</p>
            <p className="hero-description">{copy.hero.description}</p>
          </div>

          <div className="hero-cta-row">
            <a href="#demo" className="primary-button">
              {copy.hero.primaryCta}
            </a>
            <a href="#try" className="secondary-button">
              {copy.hero.secondaryCta}
            </a>
            <a href="#try" className="ghost-button">
              {copy.hero.tertiaryCta}
            </a>
          </div>

          <div className="hero-metrics">
            {copy.hero.metrics.map((metric) => (
              <div key={metric.label} className="metric-card">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="hero-visual">
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
      </div>
    </section>
  )
}
