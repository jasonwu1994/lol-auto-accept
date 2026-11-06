import React from 'react';
import {Button} from '@heroui/react';
import {SunOutlined, MoonFilled, DesktopOutlined} from '@ant-design/icons';
import {useDispatch} from 'react-redux';
import {useTranslation} from 'react-i18next';
import useAppearance from '../../hooks/useAppearance';

export default function AppearanceToggle() {
  const {t} = useTranslation();
  const {mode} = useAppearance();
  const dispatch = useDispatch();
  return <div className="appearance-toggle" role="group" aria-label={t('layout.appearance')}>
    {[["light",SunOutlined],["dark",MoonFilled],["system",DesktopOutlined]].map(([value,Icon]) =>
      <Button key={value} isIconOnly size="sm" variant="tertiary" className="appearance-option"
        aria-label={t(`layout.appearanceModes.${value}`)} title={t(`layout.appearanceModes.${value}`)} aria-pressed={mode === value}
        onPress={() => dispatch({type:'change-appearanceMode',data:value})}><Icon aria-hidden="true"/></Button>)}
  </div>;
}
