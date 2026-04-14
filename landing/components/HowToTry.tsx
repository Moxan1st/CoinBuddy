'use client'

import Image from 'next/image'
import { useI18n } from '@/lib/i18n'

export default function HowToTry() {
  const { copy } = useI18n()

  return (
    <section id="try" className="content-section try-section">
      <div className="shell try-grid">
        <div className="try-copy">
          <div className="section-heading compact left">
            <p className="section-kicker">{copy.trySection.eyebrow}</p>
            <h2>{copy.trySection.title}</h2>
            <p>{copy.trySection.body}</p>
          </div>

          <div className="try-status">
            <Image
              src="/cats/打哈欠伸懒腰.png"
              alt="CoinBuddy lucky cat"
              width={132}
              height={132}
              className="pixel-cat"
            />
            <div>
              <h3>{copy.trySection.statusTitle}</h3>
              <p>{copy.trySection.statusBody}</p>
            </div>
          </div>
        </div>

        <div className="try-cards">
          {copy.trySection.cards.map((card) => (
            <a
              key={card.title}
              href={card.href}
              className={card.placeholder ? 'try-card placeholder' : 'try-card'}
            >
              <p className="try-card-title">{card.title}</p>
              <p className="try-card-body">{card.body}</p>
              <span className="try-card-action">{card.action}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
