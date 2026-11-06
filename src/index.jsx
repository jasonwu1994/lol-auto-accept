import './motionPreference';
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import {Provider} from 'react-redux'
import store from './redux/store'
import ApiUtils from "./api/api-utils";
import "./i18n/i18n";
import {HashRouter} from 'react-router-dom';
import ThemeProvider from './theme';

const root = ReactDOM.createRoot(document.getElementById('root'));
ApiUtils.setStore(store)

root.render(
  <Provider store={store}>
    <HashRouter>
      <ThemeProvider>
        <App/>
      </ThemeProvider>
    </HashRouter>
  </Provider>
);