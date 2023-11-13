import {combineReducers} from 'redux'
import {configureStore} from '@reduxjs/toolkit'
import ConfigReducer from './reducers/ConfigReducer'
import AuthReducer from "./reducers/AuthReducer";
import GameReducer from "./reducers/GameReducer";

const reducer = combineReducers({
  AuthReducer,
  ConfigReducer,
  GameReducer
})

const store = configureStore({
  reducer: reducer,
  devTools: process.env.NODE_ENV !== 'production'
})

export default store
