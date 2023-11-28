import React, {useState, useEffect} from 'react';
import {connect} from "react-redux";
import Team from "./Team";
import withErrorBoundary from "./error/withErrorBoundary";
import {useTranslation} from 'react-i18next';


function Duo(props) {
  const [duoList, setDuoList] = useState({teamOne: [], teamTwo: []});
  const {t} = useTranslation();


  useEffect(() => {
    if (
      props.gameflowSession?.gameData?.teamOne &&
      props.gameflowSession?.gameData?.teamTwo
    ) {
      let teamOne = findSameParticipants(props.gameflowSession.gameData.teamOne);
      let teamTwo = findSameParticipants(props.gameflowSession.gameData.teamTwo);
      console.log(teamOne);
      setDuoList({teamOne, teamTwo});
    }
  }, [props.gameflowSession]);

  return (
    <div>
      {duoList.teamOne.length !== 0 && <Team title={t('common.teamOne')} team={duoList.teamOne}/>}
      {duoList.teamTwo.length !== 0 && <Team title={t('common.teamTwo')} team={duoList.teamTwo}/>}
    </div>
  )
}

function findSameParticipants(data) {
  const participants = data.reduce((acc, cur) => {
    const participantId = cur.teamParticipantId;
    acc[participantId] = acc[participantId] ? [...acc[participantId], cur] : [cur];
    return acc;
  }, {});
  return Object.values(participants).sort((a, b) => b.length - a.length);
}

const mapStateToProps = (state) => {
  return {
    gameflowSession: state.GameReducer.gameflowSession
  }
}

export default connect(mapStateToProps)(withErrorBoundary(Duo))