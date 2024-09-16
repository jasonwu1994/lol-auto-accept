import React, {useState} from 'react';
import {connect} from "react-redux";
import withErrorBoundary from "./error/withErrorBoundary";
import {Tabs} from 'antd';
import {useTranslation} from 'react-i18next';
import {trackEvent} from './GoogleAnalytics';
import ChampionsBalance from "./ARAM/ChampionsBalance";
import ChampionsPick from "./ARAM/ChampionsPick";


function ARAM(props) {
  const [current, setCurrent] = useState('balance');
  const {t} = useTranslation();

  const items = [
    {
      key: 'balance',
      label: t('aram.balanceTab'),
      children: <ChampionsBalance />
    },
    {
      key: 'pick',
      label: t('aram.pickTab'),
      children: <ChampionsPick />
    }
  ];

  return (
    <div>
      <Tabs
        defaultActiveKey="balance"
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