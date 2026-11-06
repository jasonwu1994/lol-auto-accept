import {trackEvent} from '../../analytics/client';
import React from 'react';
import {Button as HeroButton, Switch as HeroSwitch, Select as HeroSelect, ListBox, Radio, RadioGroup, Tabs as HeroTabs, Slider as HeroSlider, NumberField, Alert as HeroAlert, CloseButton, Spinner, toast} from '@heroui/react';
import {useTranslation} from 'react-i18next';

export function Button({type, danger, icon, loading, disabled, onClick, children, ...props}) {
  return <HeroButton size="sm" variant={danger ? 'danger-soft' : type === 'primary' ? 'primary' : 'secondary'} isDisabled={disabled || loading} onClick={onClick} {...props}>
    {loading ? <Spinner size="sm"/> : icon}{children}
  </HeroButton>;
}
export function Switch({checked, disabled, size, children, id, ...props}) {
  return <HeroSwitch id={id} {...props} size={size === 'small' ? 'sm' : 'md'} isSelected={checked} isDisabled={disabled}>
    <HeroSwitch.Content><HeroSwitch.Control><HeroSwitch.Thumb/></HeroSwitch.Control></HeroSwitch.Content>
  </HeroSwitch>;
}
const textOf = label => typeof label === 'string' ? label : label?.props?.children;
export function Select({options, disabled, size, id, ...props}) {
  return <HeroSelect {...props} isDisabled={disabled} className="compact-select">
    <HeroSelect.Trigger id={id}><HeroSelect.Value/><HeroSelect.Indicator/></HeroSelect.Trigger>
    <HeroSelect.Popover className="compact-select-popover"><ListBox>{options.map(option => <ListBox.Item key={option.value} id={option.value} textValue={textOf(option.label)}>
      {option.label}<ListBox.ItemIndicator/>
    </ListBox.Item>)}</ListBox></HeroSelect.Popover>
  </HeroSelect>;
}
export function Tabs({activeKey, onChange, items}) {
  return <HeroTabs variant="secondary" className="page-tabs" selectedKey={activeKey} onSelectionChange={key=>{onChange(key);trackEvent('tab_changed',{tab:String(key)});}}>
    <HeroTabs.ListContainer><HeroTabs.List aria-label={items.map(item => item.label).join(' / ')}>
      {items.map(item => <HeroTabs.Tab key={item.key} id={item.key}>{item.label}<HeroTabs.Indicator/></HeroTabs.Tab>)}
    </HeroTabs.List></HeroTabs.ListContainer>
    {items.map(item => <HeroTabs.Panel key={item.key} id={item.key} className={item.className}>{item.children}</HeroTabs.Panel>)}
  </HeroTabs>;
}
export function RankedChoice({options, value, onChange, disabled, ...props}) {
  return <RadioGroup {...props} className="ranked-choice" orientation="horizontal" value={value} onChange={onChange} isDisabled={disabled}>
    {options.map(option => <Radio key={option.value} value={option.value} className="ranked-choice-option">
      <Radio.Content className="ranked-choice-content">
        <svg className="ranked-choice-check" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span>{option.label}</span>
      </Radio.Content>
    </Radio>)}
  </RadioGroup>;
}
export function Slider({min, max, disabled, ...props}) {
  return <HeroSlider {...props} minValue={min} maxValue={max} isDisabled={disabled}>
    <HeroSlider.Track><HeroSlider.Fill/><HeroSlider.Thumb/></HeroSlider.Track>
  </HeroSlider>;
}
export function InputNumber({min, max, disabled, size, onChange, ...props}) {
  return <NumberField {...props} minValue={min} maxValue={max} isDisabled={disabled} onChange={value => {if (Number.isFinite(value)) onChange(value);}}>
    <NumberField.Group className="compact-number-group"><NumberField.Input className="compact-number"/><span className="compact-number-steppers"><NumberField.IncrementButton/><NumberField.DecrementButton/></span></NumberField.Group>
  </NumberField>;
}
export function Alert({type, message, closable, onClose}) {
  const {t} = useTranslation();
  return <HeroAlert status={type === 'error' ? 'danger' : type === 'info' ? 'accent' : type}>
    <HeroAlert.Indicator/><HeroAlert.Content><HeroAlert.Title>{message}</HeroAlert.Title></HeroAlert.Content>
    {closable && <CloseButton aria-label={t('common.close')} onPress={onClose}/>}
  </HeroAlert>;
}
export function Spin({fullscreen}) {
  const {t} = useTranslation();
  return <span className={fullscreen ? 'fullscreen-loading' : undefined}><Spinner aria-label={t('common.loading')}/></span>;
}
export function Space({wrap, children}) {return <span className="control-space" style={{flexWrap: wrap ? 'wrap' : undefined}}>{children}</span>;}
// A single stable notification API keeps event subscriptions independent of renders.
const notifications = {
  success: content => toast.success(content),
  error: content => toast.danger(content),
  open: ({type, content}) => type === 'error' ? toast.danger(content) : type === 'success' ? toast.success(content) : toast(content),
};
export const message = {useMessage: () => [notifications, null]};
// HeroUI v3 has no Image component; retain native image loading and error fallback.
export function Image({preview, fallback, alt = '', ...props}) {
  return <img {...props} alt={alt} onError={fallback ? event => {if (event.currentTarget.src !== fallback) event.currentTarget.src = fallback;} : undefined}/>;
}

