const {Content, Sider} = Layout;
import React, {useEffect} from 'react';
import {Layout, Menu, theme} from 'antd';
import {useTranslation} from 'react-i18next';
import {Routes, Route, useNavigate} from "react-router-dom";
import VisibleSwitch from "./VisibleSwitch";
import GoogleAnalytics from "./GoogleAnalytics";

const MyLayout = ({children}) => {
  const navigate = useNavigate();
  const {t} = useTranslation();
  const measurementId = 'G-JDEJZFZKCV';// GA4

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
    getItem(t('menu.aram'), '/aram'),
    getItem(t('menu.selectedRole'), '/selectedRole'),
    getItem(t('menu.about'), '/about'),
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