import {useEffect, useState} from 'react';
import {useSelector} from 'react-redux';
export default function useAppearance() {
  const configured = useSelector(state => state.ConfigReducer.appearanceMode);
  const savedDark = useSelector(state => state.ConfigReducer.isDarkMode);
  const mode = configured || (savedDark ? 'dark' : 'light');
  const [systemDark, setSystemDark] = useState(() => typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : savedDark);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return {mode, dark: mode === 'system' ? systemDark : mode === 'dark'};
}
