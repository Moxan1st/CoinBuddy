'use client'

import { useI18n } from '@/lib/i18n'

export default function WhyDifferent() {
  const { copy } = useI18n()

  return (
    <section id="difference" className="content-section contrast-section">
      <div className="shell">
        <div className="section-heading">
          <p className="section-kicker">{copy.differences.eyebrow}</p>
          <h2>{copy.differences.title}</h2>
          <p>{copy.differences.intro}</p>
        </div>

        <div className="difference-grid">
          {copy.differences.items.map((item) => (
            <article key={item.kicker} className="difference-card">
              <p className="difference-kicker">{item.kicker}</p>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <div className="difference-meta">
                <span>{item.meta}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
