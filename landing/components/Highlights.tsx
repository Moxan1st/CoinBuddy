'use client'

import Image from 'next/image'
import { useI18n } from '@/lib/i18n'

export default function Highlights() {
  const { copy } = useI18n()

  return (
    <section id="highlights" className="content-section">
      <div className="shell">
        <div className="section-heading section-heading-inset">
          <p className="section-kicker">{copy.highlights.eyebrow}</p>
        </div>

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
    </section>
  )
}
