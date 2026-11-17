// The app's page tabs (HeroUI secondary tabs with an underline, as on 隨機單中) for
// switches whose content is rendered by the caller, such as a match card's detail tabs
// or a sort order.
import { Tabs } from '@heroui/react'
import type { Key } from 'react'

export interface HeroTabItem<T extends string> {
  value: T
  label: string
}

export function HeroTabs<T extends string>({ items, value, label, size = 'md', className = '', onChange }: {
  items: Array<HeroTabItem<T>>
  value: T
  /** Accessible name of the tab list. */
  label: string
  /** `sm` is the compact form used inside sidebar panes. */
  size?: 'sm' | 'md'
  className?: string
  onChange: (value: T) => void
}) {
  return (
    <Tabs
      variant="secondary"
      className={`page-tabs mh-hero-tabs ${size === 'sm' ? 'mh-hero-tabs-sm' : ''} ${className}`}
      selectedKey={value}
      onSelectionChange={(key: Key) => {
        if (String(key) !== value) onChange(String(key) as T)
      }}
    >
      <Tabs.ListContainer>
        <Tabs.List aria-label={label}>
          {items.map(item => (
            <Tabs.Tab key={item.value} id={item.value}>
              {item.label}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  )
}
