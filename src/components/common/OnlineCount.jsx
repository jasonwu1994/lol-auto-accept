import React, {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {desktop} from '../../desktop/tauri';
export function validOnlineCount(value, now=Date.now()) {
  const age=now-Date.parse(value?.updatedAt);
  return (value?.schemaVersion===undefined||value.schemaVersion===1)&&(value?.available===undefined||value.available===true)&&Number.isSafeInteger(value?.activeUsers)&&value.activeUsers>=0&&value.windowMinutes===5&&age>=-30000&&age<=180000;
}
export default function OnlineCount() {
  const [value,setValue]=useState(null);
  const {t}=useTranslation();
  useEffect(()=>{
    let active=true,pending=false;
    const refresh=async()=>{
      if(pending)return;pending=true;
      try {const result=await desktop.invoke('get_online_count');if(active)setValue(validOnlineCount(result)?result:null);}
      catch {if(active)setValue(null);}finally{pending=false;}
    };
    refresh();const timer=setInterval(refresh,60000);
    const expiry=setInterval(()=>setValue(old=>validOnlineCount(old)?old:null),10000);
    return ()=>{active=false;clearInterval(timer);clearInterval(expiry);};
  },[]);
  // The slot is always reserved so the navigation does not jump when the count appears or expires.
  return <div className="online-slot">
    {value && <div className="online-count" role="status" title={t('layout.onlineCount',{count:value.activeUsers})} aria-label={t('layout.onlineCount',{count:value.activeUsers})}>
      <span className="online-count-dot" aria-hidden="true"/>
      <span className="online-count-label" aria-hidden="true">{t('layout.onlineLabel')}</span>
      <strong className="online-count-number" aria-hidden="true">{value.activeUsers.toLocaleString()}</strong>
    </div>}
  </div>;
}
