import OnlineCount from './common/OnlineCount';
import GoogleAnalytics from './GoogleAnalytics';
import {useRosterRecovery} from '../hooks/useCurrentRoster';
import LanguagePicker from './common/LanguagePicker';
import AppearanceToggle from './common/AppearanceToggle';
import ThemePicker from './common/ThemePicker';
import {isNewerVersion} from '../desktop/versions';
import ApiUtils from '../api/api-utils';
import React, {useEffect, useRef, useState} from 'react';
import {
  AimOutlined, HistoryOutlined, HomeOutlined, InfoCircleOutlined,
  HolderOutlined, SortAscendingOutlined,
  TeamOutlined, TrophyOutlined, UnorderedListOutlined
} from '@ant-design/icons';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector, useStore} from 'react-redux';
import {Routes, Route, NavLink, useNavigate, useLocation} from "react-router-dom";
import VisibleSwitch from "./VisibleSwitch";
import logo from '../resources/logo.png';
import useRecentMatches from '../hooks/useRecentMatches';
import {moveNavItem, navDragLayout, normalizeNavOrder} from './common/navigationOrder';


import _package from "../../package.json";

const navItems = [
  {path: '/main', labelKey: 'menu.main', icon: <HomeOutlined/>},
  {path: '/duo', labelKey: 'menu.duo', icon: <TeamOutlined/>},
  {path: '/rank', labelKey: 'menu.rank', icon: <TrophyOutlined/>},
  {path: '/recentPlayers', labelKey: 'menu.recentPlayers', icon: <HistoryOutlined/>},
  {path: '/aram', labelKey: 'menu.aram', icon: <AimOutlined/>},
  {path: '/selectedRole', labelKey: 'menu.selectedRole', icon: <UnorderedListOutlined/>},
  {path: '/about', labelKey: 'menu.about', icon: <InfoCircleOutlined/>},
];

const MyLayout = ({children}) => {
  useRosterRecovery();
  const navigate = useNavigate();
  const location = useLocation();
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const store = useStore();
  const savedOrder = useSelector(state => state.ConfigReducer.navOrder);
  const [draftOrder, setDraftOrder] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [drag, setDrag] = useState(null);
  const [justSorted, setJustSorted] = useState(false);
  const dragSource = useRef(null);
  const settleTimer = useRef(null);
  const resetFrame = useRef(null);
  const navRef = useRef(null);
  const {games: recentGames, loading: recentLoading, error: recentError} = useRecentMatches();
  const recentCount = !recentLoading && !recentError ? recentGames.length : 0;
  const sortedItems = (draftOrder ?? normalizeNavOrder(savedOrder)).map(path => navItems.find(item => item.path === path));
  const sorting = draftOrder !== null;
  const dragLayout = drag ? navDragLayout(drag.fromIndex,sortedItems.length,drag.offset,drag.step) : null;

  const saveOrder = async () => {
    setSavingOrder(true);
    try {
      await dispatch({type:'change-navOrder',data:draftOrder});
      if (JSON.stringify(store.getState().ConfigReducer.navOrder) === JSON.stringify(draftOrder)) setDraftOrder(null);
    } finally {setSavingOrder(false);}
  };
  const clearDrag = () => {clearTimeout(settleTimer.current); dragSource.current = null; setDrag(null);};
  const dragStep = handle => handle.closest('[data-nav-path]').offsetHeight + parseFloat(getComputedStyle(navRef.current).rowGap || '0');
  const settleDrag = (cancel = false) => {
    const active = dragSource.current;
    if (!active || active.phase !== 'dragging') return;
    const target = cancel ? active.fromIndex : navDragLayout(active.fromIndex,sortedItems.length,active.offset,active.step).toIndex;
    const settling = {...active,offset:(target-active.fromIndex)*active.step,phase:'settling'};
    dragSource.current = settling;
    setDrag(settling);
    settleTimer.current = setTimeout(() => {
      setJustSorted(true);
      if (!cancel) setDraftOrder(order => moveNavItem(order,active.path,order[target],target > active.fromIndex ? 'after' : 'before'));
      dragSource.current = null;
      setDrag(null);
      resetFrame.current = requestAnimationFrame(() => {
        resetFrame.current = requestAnimationFrame(() => setJustSorted(false));
      });
    },240);
  };
  const moveDrag = event => {
    const active = dragSource.current;
    if (!active || active.phase !== 'dragging' || active.pointerId !== event.pointerId) return;
    const next = {...active,offset:event.clientY-active.startY};
    dragSource.current = next;
    setDrag(next);
  };
  useEffect(() => () => {clearTimeout(settleTimer.current); cancelAnimationFrame(resetFrame.current);}, []);

  const [isNewVersionAvailable, setIsNewVersionAvailable] = useState(false);

  useEffect(() => {
    const checkForNewVersion = () => {
      ApiUtils.getLatestRelease().then(data=>({data}))
        .then(response => {
          setIsNewVersionAvailable(isNewerVersion(_package.version,response.data.tag_name) === true);
        })
        .catch(error => {
          console.error('Error fetching latest release:', error);
          setIsNewVersionAvailable(false);
        });
    };
    checkForNewVersion();
    const interval = setInterval(checkForNewVersion, 10800000); // 3小時

    return () => clearInterval(interval);
  }, []);


  useEffect(() => {
    if (location.pathname === '/' || location.pathname.includes('index.html')) {
      navigate('/main', {replace: true});
    }
  }, [location, navigate]);

  return (
    <div className="app-shell">
      <GoogleAnalytics/>
      <aside className={sorting ? 'app-sidebar is-sorting' : 'app-sidebar'}>
        <div className="app-brand">
          <img className="app-brand-mark" src={logo} alt=""/>
          <span className="app-brand-name">
            <strong>Auto Accept</strong>
            <span>v{_package.version}</span>
          </span>
        </div>
        <OnlineCount/>
        {sorting && <div className="app-nav-tools">
          <button type="button" className="nav-edit-button primary" disabled={savingOrder || Boolean(drag)} onClick={saveOrder}>{t(savingOrder ? 'layout.savingOrder' : 'layout.saveOrder')}</button>
          <button type="button" className="nav-edit-button" disabled={savingOrder || Boolean(drag)} onClick={() => {setDraftOrder(null); clearDrag();}}>{t('layout.cancelOrder')}</button>
        </div>}
        <nav ref={navRef} className={`app-nav${drag ? ' is-dragging' : ''}${justSorted ? ' just-sorted' : ''}`} aria-label={t('layout.navigation')}>
          {sortedItems.map((item,index) => sorting ? <div key={item.path}
            className={`app-nav-sort-row${drag?.path === item.path ? ` is-${drag.phase}` : ''}`}
            data-nav-path={item.path}
            style={{transform:`translate3d(0,${dragLayout?.offsets[index] ?? 0}px,0) scale(${drag?.path === item.path && drag.phase === 'dragging' ? 1.02 : 1})`}}>
            <button type="button" className="nav-drag-handle" disabled={savingOrder}
              aria-label={t('layout.dragPage',{page:t(item.labelKey)})}
              title={t('layout.dragPage',{page:t(item.labelKey)})}
              onPointerDown={event => {
                if (savingOrder || dragSource.current || event.button !== 0) return;
                event.preventDefault();
                const active = {path:item.path,fromIndex:index,startY:event.clientY,offset:0,step:dragStep(event.currentTarget),pointerId:event.pointerId,phase:'dragging'};
                dragSource.current = active;
                setDrag(active);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={moveDrag}
              onPointerUp={event => {
                moveDrag(event);
                settleDrag();
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => settleDrag(true)}
              onLostPointerCapture={() => settleDrag(true)}
              onKeyDown={event => {
                if (event.key === 'Escape') {settleDrag(true); return;}
                const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
                if (!delta || dragSource.current || index + delta < 0 || index + delta >= sortedItems.length) return;
                event.preventDefault();
                const step = dragStep(event.currentTarget);
                dragSource.current = {path:item.path,fromIndex:index,startY:0,offset:delta*step,step,phase:'dragging'};
                settleDrag();
              }}><HolderOutlined aria-hidden="true"/></button>
            {item.icon}<span className="app-nav-label">{t(item.labelKey)}</span>
          </div> : <NavLink key={item.path} to={item.path} title={item.path === '/recentPlayers' && recentCount ? t('layout.recentData',{count:recentCount}) : t(item.labelKey)}>
            {item.icon}
            <span className="app-nav-label">{t(item.labelKey)}</span>
            {item.path === '/recentPlayers' && recentCount > 0 && <span className="app-nav-data-badge" aria-label={t('layout.recentData',{count:recentCount})}>{recentCount}</span>}
            {item.path === '/about' && isNewVersionAvailable && <span className="app-nav-badge">{t('layout.newVersion')}</span>}
          </NavLink>)}
        </nav>
        <div className="app-sidebar-footer">
          <div className="sidebar-preferences"><AppearanceToggle/><LanguagePicker/></div>
          <div className="sidebar-theme-row">
            <ThemePicker/>
            <button type="button" className="nav-reorder-button" title={t('layout.reorder')} aria-label={t('layout.reorder')}
              disabled={sorting} onClick={() => setDraftOrder(normalizeNavOrder(savedOrder))}>
              <SortAscendingOutlined aria-hidden="true"/>
            </button>
          </div>
        </div>
      </aside>
      <main className="app-content">
        {children}

        <Routes>
          <Route path="/*" element={<VisibleSwitch/>}/>
        </Routes>
      </main>
    </div>
  );
}

export default MyLayout;
