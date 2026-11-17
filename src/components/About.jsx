import {isNewerVersion} from '../desktop/versions';
import React, {useEffect, useState} from 'react';
import {connect} from "react-redux";
import {Trans, useTranslation} from 'react-i18next';
import {desktop,perform} from '../desktop/tauri';
import ApiUtils from '../api/api-utils';
import logo from '../resources/logo.png'
import {Button, Image} from './common/Controls';
import {ProgressBar} from '@heroui/react';
import BorderBeam from './common/BorderBeam';
import {GithubOutlined} from '@ant-design/icons';
import {trackEvent} from './GoogleAnalytics';


import _package from "../../package.json";

function About(props) {
  const {t} = useTranslation();
  const [latestVersion, setLatestVersion] = useState(null);
  const [releaseUrl, setReleaseUrl] = useState('');
  // idle → downloading → restarting, or error (the button then retries).
  const [update, setUpdate] = useState({status:'idle', downloaded:0, total:0});

  useEffect(() => {
    let stop = null, active = true;
    desktop.listenUpdateProgress(({downloaded,total}) => setUpdate(value => value.status === 'downloading' ? {...value, downloaded, total} : value))
      .then(unlisten => {if (active) stop = unlisten; else unlisten();})
      .catch(() => {});
    return () => {active = false; stop?.();};
  }, []);

  const installUpdate = () => {
    setUpdate({status:'downloading', downloaded:0, total:0});
    desktop.invoke('install_app_update')
      .then(() => setUpdate(value => ({...value, status:'restarting'})))
      .catch(error => setUpdate(value => ({...value, status:'error', error})));
  };

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
          {latestVersion !== null && isNewerVersion(_package.version, latestVersion) &&
            <Button type="primary" className="about-update-button" disabled={update.status === 'downloading' || update.status === 'restarting'} onClick={installUpdate}>
              {update.status === 'error' ? t('about.updateRetry') : t('about.updateNow')}
            </Button>}
        </dd>
      </dl>
      {update.status !== 'idle' && <UpdateStatus update={update} t={t}/>}
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

const megabytes = bytes => (bytes / 1024 / 1024).toFixed(1);

function UpdateStatus({update, t}) {
  if (update.status === 'error') {
    const reason = update.error?.code === 'PermissionDenied' ? t('about.updateNoPermission') : (typeof update.error === 'string' ? update.error : update.error?.message || update.error?.code || '');
    return <p className="about-update-status about-update-error" role="alert">{t('about.updateFailed', {reason})}</p>;
  }
  const percent = update.total ? Math.round(update.downloaded / update.total * 100) : 0;
  const label = update.status === 'restarting' ? t('about.updateRestarting')
    : t('about.updateDownloading', {downloaded:megabytes(update.downloaded), total:update.total ? megabytes(update.total) : '…', percent});
  return <div className="about-update-status">
    <ProgressBar aria-label={t('about.updateNow')} value={update.status === 'restarting' ? 100 : percent} isIndeterminate={update.status === 'downloading' && !update.total} size="sm">
      <ProgressBar.Track><ProgressBar.Fill/></ProgressBar.Track>
    </ProgressBar>
    <span aria-live="polite">{label}</span>
  </div>;
}

const mapStateToProps = (state) => {
  return {
    gameflowSession: state.GameReducer.gameflowSession
  }
}

export default connect(mapStateToProps)(About)
