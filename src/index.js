import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import {Provider} from 'react-redux'
import store from './redux/store'
import ApiUtils from "./api/api-utils";
import "./i18n/i18n";
import {BrowserRouter} from 'react-router-dom';
import ThemeProvider from './theme';

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

const root = ReactDOM.createRoot(document.getElementById('root'));
ApiUtils.setStore(store)

root.render(
  <Provider store={store}>
    <BrowserRouter>
      <ThemeProvider>
        <App/>
      </ThemeProvider>
    </BrowserRouter>
  </Provider>
);