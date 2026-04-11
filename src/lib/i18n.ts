/** Language detection & bilingual text helper for content scripts */

/** Detect text language by Chinese character ratio (mirrors brain.ts detectLang) */
export function detectLang(text: string): "zh" | "en" {
  const zhChars = text.match(/[\u4e00-\u9fff]/g)
  return zhChars && zhChars.length / text.length > 0.15 ? "zh" : "en"
}

/** Infer user language from the most recent user message */
export function getUserLang(messages: Array<{ role: string; text: string }>): "zh" | "en" {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return detectLang(messages[i].text)
    }
  }
  // Fallback to browser language when no user messages yet
  return navigator.language.startsWith("zh") ? "zh" : "en"
}

/** Bilingual text selector */
export function L(lang: "zh" | "en", zh: string, en: string): string {
  return lang === "zh" ? zh : en
}
