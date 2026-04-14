'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type Locale = 'en' | 'zh'

type NavItem = {
  label: string
  href: string
}

type HeroMetric = {
  label: string
  value: string
}

type HeroScenario = {
  key: string
  tab: string
  title: string
  messages: Array<{
    speaker: 'user' | 'agent'
    text: string
    ctaLabel?: string
  }>
}

type HighlightItem = {
  key: string
  title: string
  body: string
  eyebrow: string
  catSrc: string
  catAlt: string
}

type DifferenceItem = {
  title: string
  body: string
  kicker: string
}

type TryCard = {
  title: string
  body: string
  action: string
  href: string
  placeholder: boolean
}

type FooterLink = {
  label: string
  href: string
  placeholder?: boolean
}

type PageCopy = {
  meta: {
    languageLabel: string
    switchLabel: string
    hackathonNote: string
  }
  nav: NavItem[]
  hero: {
    badge: string
    title: string
    subtitle: string
    description: string
    panelTitle: string
    primaryCta: string
    secondaryCta: string
    tertiaryCta: string
    heroNote: string
    userLabel: string
    agentLabel: string
    metrics: HeroMetric[]
    statusChips: string[]
    scenarios: HeroScenario[]
  }
  highlights: {
    eyebrow: string
    title: string
    intro: string
    items: HighlightItem[]
  }
  demo: {
    eyebrow: string
    title: string
    body: string
    noteKicker: string
    noteBody: string
    placeholderLabel: string
    placeholderHint: string
  }
  differences: {
    eyebrow: string
    title: string
    intro: string
    items: (DifferenceItem & { meta: string })[]
  }
  trySection: {
    eyebrow: string
    title: string
    body: string
    cards: TryCard[]
    statusTitle: string
    statusBody: string
  }
  footer: {
    note: string
    contactLabel: string
    links: FooterLink[]
    copyright: string
  }
}

const copy: Record<Locale, PageCopy> = {
  en: {
    meta: {
      languageLabel: 'English',
      switchLabel: '切换到中文',
      hackathonNote: 'CoinBuddy turns wallet intent into conversation.',
    },
    nav: [
      { label: 'Highlights', href: '#highlights' },
      { label: 'Demo', href: '#demo' },
      { label: 'Why Different', href: '#difference' },
    ],
    hero: {
      badge: 'PIXEL PET x DEFI AGENT',
      title: 'CoinBuddy',
      subtitle: 'PIXEL PET x DEFI AGENT',
      description:
        'Ask for vault ideas, route deposits, swap or bridge assets, and define strategies — all in one chat.',
      panelTitle: 'Coby works for you',
      primaryCta: 'Watch Demo',
      secondaryCta: 'Install Extension',
      tertiaryCta: 'Join Waitlist',
      heroNote: 'Ask Coby to start a transaction.',
      userLabel: 'USER',
      agentLabel: 'Coby',
      metrics: [
        { label: 'Interface', value: 'Voice / Text' },
        { label: 'Execution', value: 'Swap / Bridge / Deposit' },
        { label: 'Automation', value: 'Plain-English Rules' },
      ],
      statusChips: ['Smart discovery', 'One-stop execution', 'Natural interaction'],
      scenarios: [
        {
          key: 'discovery',
          tab: 'Smart discovery',
          title: 'Sniff the keyword, then verify the opportunity.',
          messages: [
            {
              speaker: 'agent',
              text: 'Meow~ Found a $5,000 USDC prize pool for a 5-day dev sprint, not a yield farm. That "yield in the back" line is marketing, not real APY. Want me to sniff actual protocols like Aave or Pendle instead?',
            },
            {
              speaker: 'user',
              text: 'Sure, check Aave for me.',
            },
            {
              speaker: 'agent',
              text: 'Meow~ Found 5 real vaults. Top picks include Morpho on Ethereum and Yo Protocol on Base. Tell me the amount and I can line up the cleanest route.',
            },
          ],
        },
        {
          key: 'execution',
          tab: 'One-stop execution',
          title: 'Chain the route into one executable flow.',
          messages: [
            {
              speaker: 'user',
              text: 'Move my USDC from Arbitrum to Base and deploy it into the vault you recommend with the fewest steps possible.',
            },
            {
              speaker: 'agent',
              text: 'Route looks viable. I can bridge to Base, show the final quote, then queue the deposit for your confirmation so the whole flow stays in one place.',
            },
          ],
        },
        {
          key: 'natural',
          tab: 'Natural interaction',
          title: 'Turn a fuzzy goal into a usable plan.',
          messages: [
            {
              speaker: 'user',
              text: 'I want to deposit into a Yo Protocol pool.',
            },
            {
              speaker: 'agent',
              text: 'Meow~ Tell me the amount, asset, and chain, and I will line up the best Yo Protocol vault.',
            },
            {
              speaker: 'user',
              text: '2 USDC, on Base.',
            },
            {
              speaker: 'agent',
              text: 'Meow~ Yo Protocol on Base is at 16.47% total APY right now. Single-asset pool, healthy TVL, and clean to enter. Want me to prepare the deposit?',
            },
            {
              speaker: 'user',
              text: 'Yes.',
            },
            {
              speaker: 'agent',
              text: 'Meow! The transaction is ready. Sign below to deposit in one go.',
              ctaLabel: 'Confirm 2 Steps & Sign',
            },
          ],
        },
      ],
    },
    highlights: {
      eyebrow: 'PRODUCT HIGHLIGHTS',
      title: '',
      intro: '',
      items: [
        {
          key: 'discover',
          eyebrow: '01 DISCOVER',
          title: 'Discover vaults across chains',
          body:
            'Surface yield options across protocols and act on them immediately.',
          catSrc: '/cats/coinbuddy-alert-puff.png',
          catAlt: 'CoinBuddy alert cat illustration',
        },
        {
          key: 'execute',
          eyebrow: '02 EXECUTE',
          title: 'Execute DeFi ops in chat',
          body:
            'Deposit, withdraw, bridge, and swap right next to the recommendation.',
          catSrc: '/cats/舔爪子.png',
          catAlt: 'CoinBuddy licking paw illustration',
        },
        {
          key: 'context',
          eyebrow: '03 CONTEXT',
          title: 'Grounded in wallet state',
          body:
            'Reasons with your positions, balances, and route constraints.',
          catSrc: '/cats/coinbuddy-thinking-upright.png',
          catAlt: 'CoinBuddy thinking cat illustration',
        },
        {
          key: 'strategy',
          eyebrow: '04 STRATEGY',
          title: 'Plain-English strategies',
          body:
            'Define automations in natural language, not one-off actions.',
          catSrc: '/cats/玩平板.png',
          catAlt: 'CoinBuddy with tablet illustration',
        },
      ],
    },
    demo: {
      eyebrow: 'DEMO',
      title: 'See CoinBuddy in Action',
      body: 'Watch Coby discover vaults, route a deposit, and execute a multi-step DeFi flow in one conversation.',
      noteKicker: 'Full Walkthrough',
      noteBody:
        'The video covers a complete flow: prompt, discovery, route preview, and final execution.',
      placeholderLabel: '',
      placeholderHint: '',
    },
    differences: {
      eyebrow: 'WHY IT FEELS DIFFERENT',
      title: '',
      intro: '',
      items: [
        {
          kicker: 'NOT JUST A DASHBOARD',
          title: 'Data alone does not move capital.',
          body:
            'Dashboards show yields. CoinBuddy lets you act on them in the same flow.',
          meta: 'Actionable yield context',
        },
        {
          kicker: 'NOT JUST A CHATBOT',
          title: 'Conversation is connected to execution.',
          body:
            'Turns a request into an operational next step, not polished text.',
          meta: 'Intent tied to execution',
        },
        {
          kicker: 'COMBINED STACK',
          title: 'LI.FI + conversational UX + strategy layer.',
          body:
            'Yield discovery, cross-chain routing, intent capture, and automation in one extension.',
          meta: 'One unified product surface',
        },
      ],
    },
    trySection: {
      eyebrow: 'HOW TO TRY',
      title: '',
      body: '',
      cards: [
        {
          title: 'View Source Code',
          body: 'Explore the full CoinBuddy codebase on GitHub',
          action: 'GitHub',
          href: 'https://github.com/Moxan1st/CoinBuddy',
          placeholder: false,
        },
        {
          title: 'Install Extension',
          body: 'Download and install CoinBuddy as a Chrome extension',
          action: 'Install Guide',
          href: 'https://github.com/Moxan1st/CoinBuddy/releases/latest',
          placeholder: false,
        },
      ],
      statusTitle: '',
      statusBody: '',
    },
    footer: {
      note: 'CoinBuddy turns wallet intent into conversation.',
      contactLabel: 'Contact',
      links: [
        { label: 'X', href: 'https://x.com/Moxan1st' },
        { label: 'GitHub', href: 'https://github.com/Moxan1st/CoinBuddy' },
        { label: 'Email', href: 'mailto:namemoxan@gmail.com' },
      ],
      copyright: '© 2026 CoinBuddy',
    },
  },
  zh: {
    meta: {
      languageLabel: '中文',
      switchLabel: 'Switch to English',
      hackathonNote: 'CoinBuddy 把钱包意图变成对话。',
    },
    nav: [
      { label: '亮点', href: '#highlights' },
      { label: '演示', href: '#demo' },
      { label: '差异点', href: '#difference' },
    ],
    hero: {
      badge: 'PIXEL PET x DEFI AGENT',
      title: 'CoinBuddy',
      subtitle: '像素宠物 x DeFi 智能体',
      description:
        '找金库、路由存款、swap / bridge、定义策略——全在一个对话里完成。',
      panelTitle: 'Coby 为您执行',
      primaryCta: '观看 Demo',
      secondaryCta: '安装扩展',
      tertiaryCta: '加入等待列表',
      heroNote: '让 Coby 一次执行多步交易。',
      userLabel: '用户',
      agentLabel: 'Coby',
      metrics: [
        { label: '交互方式', value: '语音 / 文本' },
        { label: '可执行动作', value: '兑换 / 跨链 / 存入' },
        { label: '自动化', value: '自然语言规则' },
      ],
      statusChips: ['智能发现', '一步执行', '自然交互'],
      scenarios: [
        {
          key: 'discovery',
          tab: '智能发现',
          title: '先嗅探关键词，再判断是不是真机会。',
          messages: [
            {
              speaker: 'agent',
              text: '喵～本猫嗅到一个 $5,000 USDC 奖池，但这不是收益农场，只是营销文案。要不要我去嗅真正的协议，比如 Aave 或 Pendle？',
            },
            {
              speaker: 'user',
              text: '好啊，看下 Aave 的。',
            },
            {
              speaker: 'agent',
              text: '喵～找到 5 个真实金库，前排包括 Morpho 和 Yo Protocol。告诉我金额，我帮你排出最合适的路径。',
            },
          ],
        },
        {
          key: 'execution',
          tab: '一步执行',
          title: '把跨链、换币和存入压成一条路径。',
          messages: [
            {
              speaker: 'user',
              text: '把我的 USDC 按最省步骤的路径直接部署到你推荐的金库里，需要的话自动完成跨链、兑换和存入。',
            },
            {
              speaker: 'agent',
              text: '当前路线可行。我会先整理最终报价和路径，再把跨链、兑换和存入收成一条可确认的执行流程，让你在一个界面里完成。',
            },
          ],
        },
        {
          key: 'natural',
          tab: '自然交互',
          title: '把模糊目标直接翻成可执行方案。',
          messages: [
            {
              speaker: 'user',
              text: '我想存点钱到 yo protocol 的池子。',
            },
            {
              speaker: 'agent',
              text: '喵～告诉本猫金额、资产和目标链，我就帮你把最合适的 Yo Protocol 金库找出来。',
            },
            {
              speaker: 'user',
              text: '2 USDC、Base。',
            },
            {
              speaker: 'agent',
              text: '喵～Yo Protocol 在 Base 上当前总 APY 是 16.47%。单资产池子，TVL 也够健康。要不要我直接帮你准备存入？',
            },
            {
              speaker: 'user',
              text: '好的。',
            },
            {
              speaker: 'agent',
              text: '喵！交易已就绪～点击下方按钮签名就能一键存入啦！',
              ctaLabel: 'Confirm 2 Steps & Sign',
            },
          ],
        },
      ],
    },
    highlights: {
      eyebrow: '产品亮点',
      title: '',
      intro: '',
      items: [
        {
          key: 'discover',
          eyebrow: '01 收益发现',
          title: '跨链发现收益机会',
          body:
            '自动整理多链多协议的收益，直接可操作。',
          catSrc: '/cats/coinbuddy-alert-puff.png',
          catAlt: 'CoinBuddy 警觉状态猫咪插图',
        },
        {
          key: 'execute',
          eyebrow: '02 直接执行',
          title: '对话中直接执行 DeFi 操作',
          body:
            '存入、取出、跨链、兑换，紧跟在建议旁边。',
          catSrc: '/cats/舔爪子.png',
          catAlt: 'CoinBuddy 舔爪子猫咪插图',
        },
        {
          key: 'context',
          eyebrow: '03 上下文理解',
          title: '基于钱包状态推理',
          body:
            '结合持仓、余额和路由约束给出建议。',
          catSrc: '/cats/coinbuddy-thinking-upright.png',
          catAlt: 'CoinBuddy 思考状态猫咪插图',
        },
        {
          key: 'strategy',
          eyebrow: '04 策略创建',
          title: '自然语言定义策略',
          body:
            '用一句话把意图变成可重复的 DeFi 工作流。',
          catSrc: '/cats/玩平板.png',
          catAlt: 'CoinBuddy 玩平板猫咪插图',
        },
      ],
    },
    demo: {
      eyebrow: '演示',
      title: '看看 CoinBuddy 的实际表现',
      body: '观看 Coby 发现金库、规划存入路径、并在一次对话中完成多步 DeFi 操作。',
      noteKicker: '完整演示',
      noteBody: '视频涵盖完整流程：提问、发现、路线预览和最终执行。',
      placeholderLabel: '',
      placeholderHint: '',
    },
    differences: {
      eyebrow: '差异点',
      title: '',
      intro: '',
      items: [
        {
          kicker: '不只是仪表板',
          title: '只有数据，不会自动帮用户完成资金动作。',
          body:
            '看到机会，直接衔接到执行动作。',
          meta: '把收益信息变成可执行决策',
        },
        {
          kicker: '不只是聊天机器人',
          title: '对话不是终点，执行才是价值。',
          body:
            '把请求直接推进成可执行的下一步。',
          meta: '把意图直接接到执行链路上',
        },
        {
          kicker: '整合式能力栈',
          title: 'LI.FI + 对话式体验 + 策略层。',
          body:
            '跨链路由、意图理解和自动化，收进同一个扩展里。',
          meta: '一个界面完成完整链上流程',
        },
      ],
    },
    trySection: {
      eyebrow: '如何体验',
      title: '',
      body: '',
      cards: [
        {
          title: '查看源代码',
          body: '在 GitHub 上探索完整的 CoinBuddy 代码库',
          action: 'GitHub',
          href: 'https://github.com/Moxan1st/CoinBuddy',
          placeholder: false,
        },
        {
          title: '安装扩展',
          body: '下载并安装 CoinBuddy Chrome 扩展',
          action: '安装指南',
          href: 'https://github.com/Moxan1st/CoinBuddy/releases/latest',
          placeholder: false,
        },
      ],
      statusTitle: '',
      statusBody: '',
    },
    footer: {
      note: 'CoinBuddy 把钱包意图变成对话。',
      contactLabel: '联系',
      links: [
        { label: 'X', href: 'https://x.com/Moxan1st' },
        { label: 'GitHub', href: 'https://github.com/Moxan1st/CoinBuddy' },
        { label: '邮箱', href: 'mailto:namemoxan@gmail.com' },
      ],
      copyright: '© 2026 CoinBuddy',
    },
  },
}

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  toggleLocale: () => void
  copy: PageCopy
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en')

  useEffect(() => {
    const stored = window.localStorage.getItem('coinbuddy-landing-locale')
    if (stored === 'en' || stored === 'zh') {
      setLocaleState(stored)
      return
    }

    const preferred = window.navigator.language.toLowerCase()
    if (preferred.startsWith('zh')) {
      setLocaleState('zh')
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
    window.localStorage.setItem('coinbuddy-landing-locale', locale)
  }, [locale])

  const setLocale = useCallback((value: Locale) => {
    setLocaleState(value)
  }, [])

  const toggleLocale = useCallback(() => {
    setLocaleState((current) => (current === 'en' ? 'zh' : 'en'))
  }, [])

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      toggleLocale,
      copy: copy[locale],
    }),
    [locale, setLocale, toggleLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return context
}
