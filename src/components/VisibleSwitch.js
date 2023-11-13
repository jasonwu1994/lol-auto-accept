import {useLocation} from 'react-router-dom';
import {useState, useEffect} from 'react';
import Main from './Main';
import Duo from './Duo';
import Rank from './Rank';
import ARAM from "./ARAM";
import SelectedRole from "./SelectedRole";
import About from "./About";

function VisibleSwitch() {
  const location = useLocation();
  const [visiblePath, setVisiblePath] = useState(location.pathname);

  useEffect(() => {
    setVisiblePath(location.pathname);
  }, [location]);

  const getVisibility = (path) => visiblePath.includes(path) ? 'block' : 'none';

  const routes = [
    {path: '/main', component: Main},
    {path: '/duo', component: Duo},
    {path: '/rank', component: Rank},
    {path: '/aram', component: ARAM},
    {path: '/selectedRole', component: SelectedRole},
    {path: '/about', component: About},
  ];

  return (
    <div>
      {
        routes.map(({path, component: Component}) => (
          <div key={path} style={{display: getVisibility(path)}}>
            <Component/>
          </div>
        ))
      }
    </div>
  );
}

export default VisibleSwitch;
