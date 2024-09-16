import React, {useState, useEffect} from 'react';
import {connect} from "react-redux";
import withErrorBoundary from "../error/withErrorBoundary";
import ApiUtils from "../../api/api-utils";
import {Button, Space, Switch, Table, Tabs} from 'antd';
import {useTranslation} from 'react-i18next';
import {trackEvent} from '../GoogleAnalytics';
import ChampionImage from "../common/ChampionImage";

const {ipcRenderer} = window.require('electron');
const MAX_NAMES_SIZE = 200;

function ChampionsPick(props) {
  const [summonerNames, setSummonerNames] = useState({});
  const [pickableChampIds, setPickableChampIds] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const {t} = useTranslation();


  useEffect(() => {
    const sendRequests = async () => {
      if (props.gamePhase !== 'ChampSelect') {
        setPickableChampIds([])
        setSelectedRowKeys([]);
        setSelectedRows([]);
        return;
      }
      if (pickableChampIds.length === 0) {
        ApiUtils.getPickableChampionIds()
          .then(response => {
            console.log('getPickableChampionIds ', response.data)
            setPickableChampIds(response.data)
          })
          .catch(error => console.log(error))
      }
    }
    sendRequests()
  }, [props.gamePhase]);

  useEffect(() => {
    const benchEnabled = props.champSelectSession?.benchEnabled ?? false;
    const benchChampionsLength = props.champSelectSession?.benchChampions?.length ?? 0;
    if (!benchEnabled || benchChampionsLength === 0) {
      return;
    }
    let championIds = findCommonChampions(props.champSelectSession.benchChampions, selectedRows);
    // console.log("championIds:", championIds)
    if (championIds.length === 0) {
      return
    }
    const sendRequests = async () => {
      for (let id of championIds) {
        try {
          const response = await ApiUtils.postChampSelectBenchSwap(id);
          console.log(response.data);
          setSelectedRowKeys([]);
          setSelectedRows([]);
          trackEvent('auto_swap_champion_aram')
        } catch (error) {
          console.error('Error in API request:', error);
        }
      }
    };
    sendRequests();
  }, [props.myTeam, props.champSelectSession]);

  const [isFetchingNames, setIsFetchingNames] = useState(true);
  //對召喚師名字快取
  useEffect(() => {
    const fetchSummonerNames = async () => {
      setIsFetchingNames(true);
      const names = {...summonerNames};
      for (const record of props.myTeam) {
        if (record.summonerId && (!names.hasOwnProperty(record.summonerId) || names[record.summonerId] === record.summonerId)) {
          try {
            const response = await ApiUtils.getSummonersById(record.summonerId);
            names[record.summonerId] = response[0].gameName ?? response[0].displayName;
          } catch (error) {
            names[record.summonerId] = record.summonerId;
          }
          // Check if the size of summonerNames has reached the maximum size
          if (Object.keys(names).length > MAX_NAMES_SIZE) {
            const keys = Object.keys(names);
            for (let i = 0; i < keys.length / 2; i++) {
              delete names[keys[i]];
            }
          }
        }
      }
      setSummonerNames(names);
      setIsFetchingNames(false);
    };
    fetchSummonerNames();
  }, [props.myTeam]);

  // rowSelection object indicates the need for row selection
  const rowSelection = {
    selectedRowKeys,
    onChange: (selectedRowKeys, selectedRows) => {
      console.log(`selectedRowKeys: ${selectedRowKeys}`, 'selectedRows: ', selectedRows);
      setSelectedRows(selectedRows)
      setSelectedRowKeys(selectedRowKeys)
    },
    getCheckboxProps: (record) => ({
      disabled: record.isSelf || !pickableChampIds.includes(record.championId),
      // disabled: record.isSelf,
      name: record.name,
    }),
  };

  const columns = [
    {
      title: '',
      dataIndex: 'championId',
      render: (text) => (
        <ChampionImage width={40} height={40} championId={text}/>
      ),
    },
    {
      title: t('aram.champion'),
      dataIndex: 'championName',
      render: (text, record) => {
        const isSelfText = record.isSelf ? "(" + t('aram.isYou') + ")" : "";
        return <a>{text}{isSelfText}</a>;
      },
    },
    {
      title: t('aram.summoner'),
      dataIndex: 'summonerId',
      render: (text) => <>{summonerNames[text] || text}</>,
    }
  ];

  return (
    <>
      <Button onClick={() => {
        setSelectedRowKeys([]);
        setSelectedRows([]);
      }
      }>{t('aram.clear')}</Button>
      <Space wrap>
        <label htmlFor="always-on-top-btn"
               style={{userSelect: "none", fontSize: 16, marginLeft: '10px'}}>{t('aram.alwaysOnTop')}</label>
        <Switch id="always-on-top-btn" defaultChecked={false} onChange={(checked, event) => {
          console.log(checked, event)
          ipcRenderer.send('always-on-top', '');
          trackEvent('click_always_on_top')
        }}></Switch>
      </Space>
      {
        ApiUtils.checkIsDev() &&
        <>
          <Button onClick={() => {
            setPickableChampIds([])
          }
          }>set pickable</Button>

          <Button onClick={() => {
            props.changeMyTeam([])
          }
          }>change my team1</Button>
        </>
      }

      {!isFetchingNames &&
        <Table
          rowKey="championId"
          rowSelection={{
            type: 'checkbox',
            ...rowSelection,
          }}
          columns={columns}
          dataSource={props.myTeam.filter(s => s.championId !== 0)}
          pagination={false}
          onRow={(record) => {
            return ({
              style: record.isSelf === true ?
                {backgroundColor: props.isDarkMode ? '#2C3E50' : '#E1F1E7'}
                : {},
            })
          }}
        />
      }
    </>
  );
}

function findCommonChampions(benchChampions, selectedRows) {
  const benchChampionIds = benchChampions.map(champ => champ.championId);
  const commonChampionIds = selectedRows
    .map(row => row.championId)
    .filter(championId => benchChampionIds.includes(championId));
  return commonChampionIds;
}

const mapStateToProps = (state) => {
  return {
    myTeam: state.GameReducer.myTeam,
    champSelectSession: state.GameReducer.champSelectSession,
    gamePhase: state.GameReducer.gamePhase,
    isDarkMode: state.ConfigReducer.isDarkMode
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

export default connect(mapStateToProps, mapDispatchToProp)(withErrorBoundary(ChampionsPick))