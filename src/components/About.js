import React, {useEffect, useState} from 'react';
import {connect} from "react-redux";
import {Trans, useTranslation} from 'react-i18next';
import axios from 'axios';
import logo from '../resources/logo.png'
import {Image} from "antd";

const {ipcRenderer} = window.require('electron');
const _package = require("../../package.json");

function About(props) {
  const {t} = useTranslation();
  const [latestVersion, setLatestVersion] = useState('NaN');
  const [releaseUrl, setReleaseUrl] = useState('');

  useEffect(() => {
    axios.get('https://api.github.com/repos/jasonwu1994/lol-auto-accept/releases/latest')
      .then(response => {
        setLatestVersion(response.data.tag_name);
        setReleaseUrl(response.data.html_url);
      })
      .catch(error => {
        console.error('Error fetching latest release:', error);
        setLatestVersion('NaN');
      });
  }, []);

  const handleClickLink = (event, url) => {
    event.preventDefault();
    ipcRenderer.send('open-link', url);
  }

  return (
    <div>
      <div style={{textAlign: "center"}}>
        <Image width={250} height={250} style={{userSelect: "none"}} preview={false}
               src={logo}
        />
        <h1 style={{fontSize: "26px"}}>{t('about.author')}:jasonwu1994</h1>
        <div style={{marginBottom: 10}}>
          <h3 style={{fontSize: "16px"}}>{t('about.currentVersion')}: v{_package.version}</h3>
          <h3 style={{fontSize: "16px"}}>{t('about.latestVersion')}: {latestVersion === 'NaN' ? 'NaN' :
            <a href="" onClick={(event) => handleClickLink(event, releaseUrl)}>{latestVersion}</a>}
          </h3>
        </div>
        <p style={{fontSize: "16px"}}>
          <Trans i18nKey="about.help"></Trans>
          <br/>
          <a href="" style={{fontSize: "16px"}}
             onClick={(event) => handleClickLink(event, 'https://github.com/jasonwu1994/lol-auto-accept')}>
            {t('about.github')}
          </a>
        </p>
      </div>
    </div>
  )
}

const mapStateToProps = (state) => {
  return {
    gameflowSession: state.GameReducer.gameflowSession
  }
}

export default connect(mapStateToProps)(About)