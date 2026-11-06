import React from 'react';
import {Button, ListBox, Popover} from '@heroui/react';
import {useDispatch, useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {designThemes, normalizeDesignTheme} from '../../styles/designThemes';

export default function ThemePicker() {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const selected = useSelector(state => normalizeDesignTheme(state.ConfigReducer.designTheme));
  const current = designThemes.find(theme => theme.id === selected);
  return <Popover>
    <Button className="theme-trigger" variant="tertiary" size="sm" aria-label={t('layout.theme')} title={current.name}>
      <img className="theme-trigger-dot" src={current.image} alt=""/>
      <span className="theme-trigger-name">{current.name}</span>
    </Button>
    <Popover.Content placement="top start">
      <Popover.Dialog className="theme-picker" aria-label={t('layout.theme')}>
        <ListBox className="theme-grid" aria-label={t('layout.theme')} layout="grid" selectionMode="single" disallowEmptySelection
          selectedKeys={new Set([selected])}
          onSelectionChange={keys => {if (keys !== 'all') dispatch({type:'change-designTheme',data:[...keys][0]});}}>
          {designThemes.map(theme => <ListBox.Item className="theme-option" key={theme.id} id={theme.id} textValue={theme.name}>
            <img className="theme-swatch" src={theme.image} alt="" width={40} height={40}/>
            <span>{theme.name}</span>
          </ListBox.Item>)}
        </ListBox>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}
