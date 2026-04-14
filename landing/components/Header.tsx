'use client'

import Image from 'next/image'
import { useState } from 'react'
import { useI18n } from '@/lib/i18n'

export default function Header() {
  const { locale, setLocale, copy } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="site-header">
      <div className="shell header-inner">
        <a href="#" className="brand-mark" aria-label="CoinBuddy home">
          <Image
            src="/CoinBuddy ICON 深色.png"
            alt="CoinBuddy logo"
            width={168}
            height={48}
            className="brand-lockup"
          />
          <div>
            <p className="brand-subtitle">{copy.meta.hackathonNote}</p>
          </div>
        </a>

        <nav className="desktop-nav" aria-label="Primary">
          {copy.nav.map((item) => (
            <a key={item.href} href={item.href} className="nav-link">
              {item.label}
            </a>
          ))}
        </nav>

        <div className="header-actions">
          <div className="lang-switch" aria-label="Language switcher">
            <button
              type="button"
              className={locale === 'en' ? 'lang-chip active' : 'lang-chip'}
              onClick={() => setLocale('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={locale === 'zh' ? 'lang-chip active' : 'lang-chip'}
              onClick={() => setLocale('zh')}
            >
              中文
            </button>
          </div>

          <button
            type="button"
            className="menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label="Toggle menu"
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className="mobile-nav">
          <div className="shell mobile-nav-inner">
            {copy.nav.map((item) => (
              <a key={item.href} href={item.href} className="mobile-nav-link" onClick={() => setMenuOpen(false)}>
                {item.label}
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </header>
  )
}
