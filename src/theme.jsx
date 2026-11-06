import useAppearance from './hooks/useAppearance';
import {normalizeDesignTheme} from './styles/designThemes';
import {useLayoutEffect} from 'react';
import {Toast} from '@heroui/react';
import {I18nProvider} from 'react-aria';
import {useSelector} from 'react-redux';
import './styles/theme.css';

export default function ThemeProvider({children}) {
  const language = useSelector(state => state.ConfigReducer.language);
  const designTheme = useSelector(state => normalizeDesignTheme(state.ConfigReducer.designTheme));
  const {dark} = useAppearance();
  useLayoutEffect(() => {
    document.documentElement.dataset.designTheme = designTheme;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
    document.body.style.backgroundColor = 'var(--background)';
  }, [dark, designTheme]);
  return <I18nProvider locale={language === 'en' ? 'en-US' : 'zh-TW'}>{children}<Toast.Provider placement="top"/></I18nProvider>;
}
