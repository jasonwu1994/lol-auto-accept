import {useLocation} from 'react-router-dom';
import Main from './Main';
import Duo from './Duo';
import Rank from './Rank';
import RecentPlayers from './RecentPlayers';
import ARAM from "./ARAM";
import SelectedRole from "./SelectedRole";
import About from "./About";
import MatchHistoryPage from "../features/match-history/MatchHistoryPage";

function VisibleSwitch() {
  const location = useLocation();
  const routes = [
    {path: '/main', component: Main},
    {path: '/duo', component: Duo},
    {path: '/rank', component: Rank},
    {path: '/recentPlayers', component: RecentPlayers},
    {path: '/aram', component: ARAM},
    {path: '/selectedRole', component: SelectedRole},
    {path: '/match-history', component: MatchHistoryPage},
    {path: '/about', component: About},
  ];

  const route = routes.find(({path}) => location.pathname === path || location.pathname.startsWith(`${path}/`));
  const Component = route?.component;
  return <div className={route?.path === '/aram' || route?.path === '/match-history' ? 'page page-fill' : 'page'}>{Component && <Component key={route.path}/>}</div>;
}

export default VisibleSwitch;
