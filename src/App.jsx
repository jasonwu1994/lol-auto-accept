import React, {useEffect, useState} from 'react';
import {Alert, Spin, message} from './components/common/Controls';
import Layout from './components/Layout';
import {desktop, reportError} from './desktop/tauri';
import {applySnapshot} from './desktop/storeBridge';
import ApiUtils from './api/api-utils';

export default function App() {
  const [ready,setReady] = useState(false);
  const [error,setError] = useState('');
  const [blocked,setBlocked] = useState(null);
  const [operation,setOperation] = useState(null);
  const [dismissedOperation,setDismissedOperation] = useState(null);
  const [messageApi, contextHolder] = message.useMessage();
  const canShow = ready || Boolean(error);
  useEffect(() => {
    if (canShow) return desktop.scheduleShow();
  }, [canShow]);
  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};
    let stopOperations = () => {};
    const onError = event => messageApi.error(event.detail);
    window.addEventListener('desktop-error',onError);
    desktop.listenOperations().then(stop=>{if(disposed)stop();else stopOperations=stop;}).catch(reportError);
    desktop.subscribe(value => {
      if (disposed) return;
      applySnapshot(value);
      setBlocked(value.startupWarning ?? value.automationBlocked ?? null);
      setOperation(value.lastOperation ?? null);
      setReady(true);
    }).then(stop => {
      if (disposed) {stop(); return;}
      unsubscribe = stop;
      Promise.all([ApiUtils.getAllChampionsByCache('zh_TW'),ApiUtils.getAllChampionsByCache('en_US')]).catch(reportError);
    }).catch(error => {if (!disposed) setError(error.message ?? String(error));});
    return () => {disposed=true; unsubscribe(); stopOperations(); window.removeEventListener('desktop-error',onError);};
  },[messageApi]);
  return <>
    {contextHolder}
    {error ? <Alert type="error" message={error}/>
      : !ready ? <Spin fullscreen/>
        : <Layout>{blocked && <Alert type="warning" message={blocked}/>} {operation && operation.revision !== dismissedOperation && !['success','succeeded'].includes(operation.status.toLowerCase()) && <Alert key={operation.revision} closable onClose={() => setDismissedOperation(operation.revision)} type="error" message={`${operation.operation}: ${operation.message || operation.status}`}/>}</Layout>}
  </>;
}
