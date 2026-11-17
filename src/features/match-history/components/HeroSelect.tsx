// The app's HeroUI select (same classes as common/Controls `Select`), with optional
// option groups and leading icons, so the match history page matches the other pages.
import { ListBox, Select } from '@heroui/react'
import type { Key, ReactNode } from 'react'
import { Header } from 'react-aria-components'

export interface HeroSelectOption {
  value: string
  label: string
  /** Rendered before the label, in the list and in the trigger. */
  icon?: ReactNode
}

export interface HeroSelectGroup {
  label: string
  options: HeroSelectOption[]
}

function OptionLabel({ option }: { option: HeroSelectOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {option.icon}
      <span className="truncate">{option.label}</span>
    </span>
  )
}

export function HeroSelect({ value, options, groups, disabled, label, className = '', onChange }: {
  value: string
  options?: HeroSelectOption[]
  groups?: HeroSelectGroup[]
  disabled?: boolean
  /** Accessible name. */
  label: string
  /** Applied to a wrapper: the app's `.compact-select` always fills its parent. */
  className?: string
  onChange: (value: string) => void
}) {
  const all = groups ? groups.flatMap(group => group.options) : (options ?? [])
  const selected = all.find(option => option.value === value) ?? all[0]
  const item = (option: HeroSelectOption) => (
    <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
      <OptionLabel option={option} />
      <ListBox.ItemIndicator />
    </ListBox.Item>
  )
  return (
    <div className={`min-w-0 ${className}`}>
      <Select
        aria-label={label}
        className="compact-select"
        isDisabled={disabled}
        value={selected?.value ?? null}
        onChange={(key: Key | null) => {
          if (key !== null && String(key) !== selected?.value) onChange(String(key))
        }}
      >
        <Select.Trigger>
          <Select.Value>{() => (selected ? <OptionLabel option={selected} /> : null)}</Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover className="compact-select-popover mh-select-popover">
          <ListBox>
            {groups
              ? groups.map(group => (
                  <ListBox.Section key={group.label} id={group.label} aria-label={group.label}>
                    <Header className="mh-select-group">{group.label}</Header>
                    {group.options.map(item)}
                  </ListBox.Section>
                ))
              : all.map(item)}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  )
}
