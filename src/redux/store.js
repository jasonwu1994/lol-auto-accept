import {createConfigPersistence} from '../desktop/configPersistence';
import {desktop,reportError} from '../desktop/tauri';
import {combineReducers} from 'redux'
import {configureStore} from '@reduxjs/toolkit'
import ConfigReducer from './reducers/ConfigReducer'
import AuthReducer from "./reducers/AuthReducer";
import GameReducer from "./reducers/GameReducer";
import {MatchHistoryReducer} from "../features/match-history/state/tabs";
import {lifecycle as matchHistoryLifecycle} from "../features/match-history/state/lifecycle";

const reducer = combineReducers({
  AuthReducer,
  ConfigReducer,
  GameReducer,
  MatchHistoryReducer
})

const store = configureStore({
  reducer: reducer,
  middleware: getDefault => getDefault().concat(createConfigPersistence({reduce:ConfigReducer,save:(config,expectedRevision)=>desktop.invoke('update_config',{config,expectedRevision}),onStale:()=>desktop.refresh(),onError:reportError})),
  devTools: import.meta.env.DEV
})

matchHistoryLifecycle.attach(store)

export default store
