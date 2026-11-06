import React from 'react';
import {Alert,Spin} from './Controls';
import {useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
export default function GameDataStatus({loading=false,error=false}) {
  const connection=useSelector(state=>state.AuthReducer.connection);
  const {t}=useTranslation();
  if(connection!=='Connected')return null;
  if(error)return <Alert type="error" message={t('common.unavailable')}/>;
  if(loading)return <div role="status" style={{padding:24,textAlign:'center'}}><Spin/><p>{t('common.loading')}</p></div>;
  return null;
}
