import {useEffect} from 'react'
import {ConfigProvider, theme as AntdTheme} from 'antd'
import {connect} from "react-redux";
import {themeType} from "./redux/reducers/ConfigReducer";

const {ipcRenderer} = window.require('electron')

const ThemeProviderInner = ({children, isDarkMode}) => {
  const {defaultAlgorithm, darkAlgorithm} = AntdTheme

  useEffect(() => {
    ipcRenderer.send('switch-native-theme', isDarkMode ? themeType.DARK : themeType.LIGHT)
    localStorage.setItem('theme', isDarkMode ? themeType.DARK : themeType.LIGHT)
  }, [isDarkMode])

  return (
    <ConfigProvider theme={{algorithm: isDarkMode ? darkAlgorithm : defaultAlgorithm}}>
      {children}
    </ConfigProvider>
  )
}

const mapStateToProps = (state) => {
  return {
    isDarkMode: state.ConfigReducer.isDarkMode
  }
}

const ThemeProvider = connect(mapStateToProps)(({children, ...props}) => {
  return <ThemeProviderInner {...props}>{children}</ThemeProviderInner>;
});

export default ThemeProvider;