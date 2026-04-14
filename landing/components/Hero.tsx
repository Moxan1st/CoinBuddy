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

        <div className="hero-video-wrap">
          <iframe
            src="https://drive.google.com/file/d/1YBBb_9fySz5GUxp72uhZoO7f0q35YViD/preview"
            width="640"
            height="400"
            allow="autoplay"
            allowFullScreen
            style={{ border: 'none', borderRadius: 12, maxWidth: '100%', display: 'block', margin: '0 auto' }}
          />
        </div>
      </div>
    </section>
  )
}
