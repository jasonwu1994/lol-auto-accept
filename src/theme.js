
import { useEffect, createContext, useState } from 'react'
import { ConfigProvider, theme as AntdTheme, Button, Card } from 'antd'

const { ipcRenderer } = window.require('electron')

const MatchMediaDark = typeof matchMedia !== 'undefined' ? matchMedia?.('(prefers-color-scheme:dark)') : undefined
// init theme
const storageTheme = localStorage.getItem('theme') ?? 'system'
const isDark = storageTheme === 'system' ? MatchMediaDark.matches : storageTheme === 'dark'

export const ThemeContext = createContext()

export const ThemeProvider = ({ children }) => {
    const { defaultAlgorithm, darkAlgorithm } = AntdTheme

    const [theme, setTheme] = useState(() => storageTheme ?? 'system')
    const [current, setCurrent] = useState(() => isDark ? 'dark' : 'light')

    const switchTheme = (value) => {
        if (value && value !== theme) {
            setTheme(value)
        }
    }

    useEffect(() => {
        ipcRenderer.invoke('switch-native-theme', theme)
        localStorage.setItem('theme', theme)
        if (theme === 'system') {
            const isDark = MatchMediaDark?.matches
            setCurrent(isDark ? 'dark' : 'light')
        } else {
            setCurrent(theme)
        }
        
        const onSystemThemeChange = (matchMediaDark) => {
            if (theme === 'system') {
                setCurrent(matchMediaDark.matches ? 'dark' : 'light')
            }
        }

        MatchMediaDark?.addEventListener('change', onSystemThemeChange)
        return () => {
            MatchMediaDark?.removeEventListener('change', onSystemThemeChange)
        }
    }, [theme])

    return (
        <ThemeContext.Provider
            value={{
                theme,
                switchTheme,
                current
            }}
        >
            <ConfigProvider
                theme={{
                    algorithm: current === 'dark' ? darkAlgorithm : defaultAlgorithm,
                }}>
                {children}
            </ConfigProvider>
        </ThemeContext.Provider>
    )
}