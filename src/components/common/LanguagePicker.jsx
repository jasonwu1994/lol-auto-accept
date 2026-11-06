import React from 'react';
import {Button, ListBox, Popover} from '@heroui/react';
import {useDispatch, useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';

export default function LanguagePicker() {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const language = useSelector(state => state.ConfigReducer.language);
  return <Popover>
    <Button id="language-select" isIconOnly size="sm" variant="tertiary" className="language-trigger" aria-label={t('layout.language')} title={t('layout.language')}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 5h12M9 2v3M5 5c1 5 4 8 8 10M13 5c-1 5-4 8-9 11M14 21l4-10 4 10M15.5 17h5"/>
      </svg>
    </Button>
    <Popover.Content placement="top start">
      <Popover.Dialog className="language-popup" aria-label={t('layout.language')}>
        <p className="language-popup-title">{t('layout.chooseLanguage')}</p>
        <ListBox aria-label={t('layout.language')} selectionMode="single" disallowEmptySelection selectedKeys={new Set([language])}
          onSelectionChange={keys => {if(keys !== 'all') dispatch({type:'change-language',data:[...keys][0]});}}>
          {[['en','English'],['zh','繁體中文']].map(([id,name]) => <ListBox.Item id={id} key={id} textValue={name}>
            <ListBox.ItemIndicator/><span>{name}</span>
          </ListBox.Item>)}
        </ListBox>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}
