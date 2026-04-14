'use client'

import Image from 'next/image'
import { useI18n } from '@/lib/i18n'

export default function Footer() {
  const { copy } = useI18n()

  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div className="footer-brand">
          <div>
            <Image
              src="/CoinBuddy ICON 深色.png"
              alt="CoinBuddy"
              width={190}
              height={56}
              className="footer-lockup"
            />
            <p className="footer-note">{copy.footer.note}</p>
          </div>
        </div>

        <div className="footer-links">
          <span className="footer-contact-label">{copy.footer.contactLabel}</span>
          {copy.footer.links.map((link) => (
            <a key={link.label} href={link.href} className={link.placeholder ? 'footer-link placeholder' : 'footer-link'}>
              {link.label}
            </a>
          ))}
        </div>

        <p className="footer-copy">{copy.footer.copyright}</p>
      </div>
    </footer>
  )
}
