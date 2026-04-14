'use client'

import Image from 'next/image'
import { useI18n } from '@/lib/i18n'

export default function Hero() {
  const { copy } = useI18n()

  return (
    <section className="hero-section">
      <div className="shell hero-full">
        <div className="hero-title-wrap">
          <h1 className="hero-title-text">
            {copy.hero.title}
            <Image
              src="/cats/coinbuddy-done-lucky.png"
              alt="CoinBuddy lucky cat"
              width={100}
              height={100}
              className="pixel-cat hero-lucky-cat"
            />
          </h1>
        </div>

        <div className="hero-speech">
          <p className="hero-subtitle">{copy.hero.subtitle}</p>
          <p className="hero-description">{copy.hero.description}</p>
        </div>

        <div className="hero-cta-row">
          <a href="https://github.com/Moxan1st/CoinBuddy/releases/latest" className="primary-button">
            {copy.hero.secondaryCta}
          </a>
          <a href="https://github.com/Moxan1st/CoinBuddy" className="secondary-button">
            GitHub
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
    </section>
  )
}
