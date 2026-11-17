import { Fragment, type ReactNode } from 'react'

/**
 * Renders Riot / Tencent description markup (`<stats>`, `<br>`, `<magicDamage>` …)
 * as plain React nodes. Tag names only select a class; attributes, scripts, links,
 * styles and unknown elements are never rendered, so the source cannot inject
 * markup into the page (upstream used `v-html`).
 */
const STYLED = new Set([
  'active', 'attention', 'buffedstat', 'healing', 'keyword', 'keywordmajor', 'keywordstealth', 'lifesteal',
  'magicdamage', 'mainstats', 'onhit', 'passive', 'physicaldamage', 'raritygeneric', 'raritylegendary',
  'raritymythic', 'rules', 'scalead', 'scaleap', 'scalearmor', 'scalehealth', 'scalelevel', 'scalemana',
  'scalemr', 'shield', 'speed', 'spellname', 'stats', 'status', 'truedamage', 'unique', 'gold', 'flavortext',
  'li', 'b', 'i', 'font', 'recast', 'nerfedstat', 'colorff9900', 'colorffff00', 'span', 'lol-uikit-tooltipped-keyword'
])

type Node = { tag: string | null; children: Array<Node | string> }

export function parseMarkup(source: string): Node {
  const root: Node = { tag: null, children: [] }
  const stack: Node[] = [root]
  const token = /<\s*(\/)?\s*([a-zA-Z][\w-]*)[^>]*?(\/)?\s*>|([^<]+)|(<)/g
  let match: RegExpExecArray | null
  while ((match = token.exec(source))) {
    const [, closing, rawTag, selfClosing, text, stray] = match
    const top = stack[stack.length - 1]
    if (text !== undefined || stray !== undefined) {
      top.children.push(decode(text ?? stray!))
      continue
    }
    const tag = rawTag.toLowerCase()
    if (tag === 'br') {
      top.children.push('\n')
      continue
    }
    if (closing) {
      const index = stack.map(node => node.tag).lastIndexOf(tag)
      if (index > 0) stack.length = index
      continue
    }
    if (selfClosing) continue
    const node: Node = { tag, children: [] }
    top.children.push(node)
    stack.push(node)
  }
  return root
}

function decode(text: string) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function render(node: Node, key: string): ReactNode {
  const children = node.children.map((child, index) =>
    typeof child === 'string' ? (
      child === '\n' ? <br key={`${key}-${index}`} /> : <Fragment key={`${key}-${index}`}>{child}</Fragment>
    ) : (
      render(child, `${key}-${index}`)
    )
  )
  if (!node.tag) return <Fragment key={key}>{children}</Fragment>
  // Unknown and dangerous tags (script, a, img, style, iframe …) keep only their text.
  if (['script', 'style', 'iframe', 'object', 'embed', 'template'].includes(node.tag)) return null
  if (!STYLED.has(node.tag)) return <Fragment key={key}>{children}</Fragment>
  if (node.tag === 'li') return <span key={key} className="mh-riot-li">{children}</span>
  return (
    <span key={key} className={`mh-riot-${node.tag.replace(/[^a-z0-9-]/g, '')}`}>
      {children}
    </span>
  )
}

export function RiotText({ text, className }: { text?: string | null; className?: string }) {
  if (!text) return null
  return <span className={className}>{render(parseMarkup(text), 'm')}</span>
}

/** Plain text (for titles and accessible names). */
export function markupText(text?: string | null): string {
  if (!text) return ''
  const walk = (node: Node): string => node.children.map(child => (typeof child === 'string' ? child : walk(child))).join('')
  return walk(parseMarkup(text)).replace(/\s+\n/g, '\n').trim()
}
