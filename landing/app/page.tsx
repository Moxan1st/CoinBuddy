import Header from '@/components/Header'
import Hero from '@/components/Hero'
import Highlights from '@/components/Highlights'
import Demo from '@/components/Demo'
import WhyDifferent from '@/components/WhyDifferent'
import HowToTry from '@/components/HowToTry'
import Footer from '@/components/Footer'
import { I18nProvider } from '@/lib/i18n'

export default function Page() {
  return (
    <I18nProvider>
      <div className="page-shell">
        <Header />
        <main>
          <Hero />
          <Highlights />
          <Demo />
          <WhyDifferent />
          <HowToTry />
        </main>
        <Footer />
      </div>
    </I18nProvider>
  )
}
