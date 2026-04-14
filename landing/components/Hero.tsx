'use client'

import Image from 'next/image'
import { useI18n } from '@/lib/i18n'

export default function Hero() {
  const { copy } = useI18n()

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

        <div className="hero-highlights">
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
      </div>
    </section>
  )
}
