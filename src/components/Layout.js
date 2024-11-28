const {Content, Sider} = Layout;
import axios from "axios";
import React, {useEffect, useState} from 'react';
import {Layout, Menu, theme} from 'antd';
import {useTranslation} from 'react-i18next';
import {Routes, Route, useNavigate} from "react-router-dom";
import VisibleSwitch from "./VisibleSwitch";
import GoogleAnalytics from "./GoogleAnalytics";

const _package = require("../../package.json");

const MyLayout = ({children}) => {
  const navigate = useNavigate();
  const {t} = useTranslation();
  const measurementId = 'G-JDEJZFZKCV';// GA4
  const [isNewVersionAvailable, setIsNewVersionAvailable] = useState(false);

  useEffect(() => {
    const parseVersion = (versionString) => {
      if (versionString.startsWith('v')) {
        console.log("versionString:", versionString)
        return versionString.substring(1);
      }
      return versionString;
    };

    const compareVersions = (current, latest) => {
      const currentParts = current.split('.').map(Number);
      const latestParts = latest.split('.').map(Number);
      for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
        const currentPart = currentParts[i] || 0;
        const latestPart = latestParts[i] || 0;
        if (currentPart < latestPart) return true;
        if (currentPart > latestPart) return false;
      }
      return false;
    };

    const checkForNewVersion = () => {
      axios.get('https://api.github.com/repos/jasonwu1994/lol-auto-accept/releases/latest')
        .then(response => {
          const latestVersion = parseVersion(response.data.tag_name);
          const currentVersion = parseVersion(_package.version);

          if (compareVersions(currentVersion, latestVersion)) {
            setIsNewVersionAvailable(true);
          } else {
            setIsNewVersionAvailable(false);
          }
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

  const getItem = (label, key) => {
    return {
      key,
      label,
    };
  };

  const items = [
    getItem(t('menu.main'), '/main'),
    getItem(t('menu.duo'), '/duo'),
    getItem(t('menu.rank'), '/rank'),
    getItem(t('menu.recentPlayers'), '/recentPlayers'),
    getItem(t('menu.aram'), '/aram'),
    getItem(t('menu.selectedRole'), '/selectedRole'),
    getItem(isNewVersionAvailable ? "✨ " + t('menu.about') : t('menu.about'), '/about'),
  ];

  const {
    token: {colorBgContainer},
  } = theme.useToken();
  return (
    <Layout>
      <Sider width={120} style={{background: colorBgContainer}}>
        <Menu
          mode="inline"
          defaultSelectedKeys={['/main']}
          defaultOpenKeys={['/main']}
          style={{
            height: '100%',
            borderRight: 0,
            userSelect: "none"
          }}
          items={items}
          onClick={(item) => {
            navigate(item.key)
          }}
        />
      </Sider>
      <Layout style={{padding: '0 24px 24px'}}>
        <Content
          style={{
            padding: 10,
            margin: 10,
            minHeight: "89vh",
            background: colorBgContainer,
          }}
        >
          {children}
          <GoogleAnalytics measurementId={measurementId}/>
          <Routes>
            <Route path="/*" element={<VisibleSwitch/>}/>
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default MyLayout;