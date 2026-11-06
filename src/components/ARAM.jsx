import React, {useState} from 'react';
import {connect} from "react-redux";
import withErrorBoundary from "./error/withErrorBoundary";
import {Tabs} from './common/Controls';
import {useTranslation} from 'react-i18next';
import {trackEvent} from './GoogleAnalytics';
import ChampionsBalance from "./ARAM/ChampionsBalance";
import ChampionsPick from "./ARAM/ChampionsPick";


function ARAM(props) {
  const [current, setCurrent] = useState('pick');
  const {t} = useTranslation();

  const items = [
    {
      key: 'pick',
      label: t('aram.pickTab'),
      children: current === 'pick' ? <ChampionsPick /> : null
    },
    {
      key: 'balance',
      className: 'balance-panel',
      label: t('aram.balanceTab'),
      children: current === 'balance' ? <ChampionsBalance /> : null
    }
  ];

  return (
    <div className="aram-page">
      <Tabs
        activeKey={current}
        onChange={setCurrent}
        items={items}
      />
    </div>
  );
}

const mapStateToProps = (state) => {
  return {
    // myTeam: state.GameReducer.myTeam,
    // champSelectSession: state.GameReducer.champSelectSession,
    // gamePhase: state.GameReducer.gamePhase,
    // isDarkMode: state.ConfigReducer.isDarkMode
  }
}
const mapDispatchToProp = {
  changeMyTeam(data) {
    return {
      type: "change-myTeam",
      data
    }
  }
}

export default connect(mapStateToProps, mapDispatchToProp)(withErrorBoundary(ARAM))
