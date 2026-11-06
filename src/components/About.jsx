import {isNewerVersion} from '../desktop/versions';
import React, {useEffect, useState} from 'react';
import {connect} from "react-redux";
import {Trans, useTranslation} from 'react-i18next';
import {desktop,perform} from '../desktop/tauri';
import ApiUtils from '../api/api-utils';
import logo from '../resources/logo.png'
import {Button, Image} from './common/Controls';
import BorderBeam from './common/BorderBeam';
import {GithubOutlined} from '@ant-design/icons';
import {trackEvent} from './GoogleAnalytics';


import _package from "../../package.json";

function About(props) {
  const {t} = useTranslation();
  const [latestVersion, setLatestVersion] = useState(null);
  const [releaseUrl, setReleaseUrl] = useState('');

  useEffect(() => {
    let active=true;
    ApiUtils.getLatestRelease().then(data=>({data}))
      .then(response => {
        if (!active) return;
        setLatestVersion(response.data.tag_name);
        if(isNewerVersion(_package.version,response.data.tag_name))trackEvent('update_prompt_viewed',{target:'release'});
        setReleaseUrl(response.data.html_url);
      })
      .catch(error => {
        if (!active) return;
        console.error('Error fetching latest release:', error);
        setLatestVersion(null);
      });
    return ()=>{active=false;};
  }, []);

  const handleClickLink = (event, url) => {
    event.preventDefault();
    perform(desktop.invoke('open_external',{url}));
  }

  const parseVersion = (versionString) => {
    try {
      if (versionString.startsWith('v')) {
        return versionString.substring(1);
      }
      return versionString;
    } catch (error) {
      console.error('Error parsing version string:', error);
      return '';
    }
  };

  return (
    <section className="panel about-panel">
      <BorderBeam/>
      <BorderBeam delay={3} colorFrom="var(--accent-text)" colorTo="var(--accent-strong)"/>
      <Image width={160} height={160} style={{userSelect: "none"}} preview={false}
             src={logo}
      />
      <h1>{t('about.author')}: jasonwu1994</h1>
      <dl className="about-versions">
        <dt>{t('about.currentVersion')}</dt>
        <dd>v{_package.version}</dd>
        <dt>{t('about.latestVersion')}</dt>
        <dd>{latestVersion === null ? t('common.unavailable') :
          <a href="" onClick={(event) => {
            handleClickLink(event, releaseUrl)
            trackEvent('update_link_opened', {
              target: 'release',
              current_version: _package.version
            })
          }}>{latestVersion}</a>}
        </dd>
      </dl>
      <p>
        <Trans i18nKey="about.help"></Trans>
      </p>
      <Button type="primary" icon={<GithubOutlined/>}
              onClick={(event) => {
                handleClickLink(event, 'https://github.com/jasonwu1994/lol-auto-accept')
                trackEvent('external_link_opened', {
                  target: 'github',
                  current_version: _package.version
                })
              }}>{t('about.github')}
      </Button>
    </section>
  )
}

const mapStateToProps = (state) => {
  return {
    gameflowSession: state.GameReducer.gameflowSession
  }
}

export default connect(mapStateToProps)(About)
