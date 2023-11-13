import React, {useState, useEffect} from 'react';
import {connect} from "react-redux";
import withErrorBoundary from "./error/withErrorBoundary";
import ApiUtils from "../api/api-utils";
import {Button, Image, Space, Switch, Table} from 'antd';
import {useTranslation} from 'react-i18next';

const {ipcRenderer} = window.require('electron');

const MAX_NAMES_SIZE = 200;

function ARAM(props) {
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
    console.log("championIds:", championIds)
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
            names[record.summonerId] = response[0].displayName;
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
        <Image width={40} height={40} style={{userSelect: "none"}} preview={false}
               src={`https://cdn.communitydragon.org/latest/champion/${text}/square`}
               fallback="data:image/png;base64,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"
        />),
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
    <div>
      <Button onClick={() => {
        setSelectedRowKeys([]);
        setSelectedRows([]);
      }
      }>{t('aram.clear')}</Button>
      <Space wrap>
        <label htmlFor="always-on-top-btn"
               style={{userSelect: "none", fontSize: 16, marginLeft: '10px'}}>{t('aram.alwaysOnTop')}</label>
        <Switch id="always-on-top-btn" checked={props.isAutoAccept} onChange={(checked, event) => {
          console.log(checked, event)
          ipcRenderer.send('always-on-top', '');
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
          onRow={(record) => ({
            style: record.isSelf === true ? {backgroundColor: '#E1F1E7'} : {},
          })}
        />
      }
    </div>
  );
}

const binarySearchInsert = (array, value, compareFn) => {
  let left = 0;
  let right = array.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const compare = compareFn(value, array[mid]);
    if (compare === 0) {
      return mid;
    } else if (compare < 0) {
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }
  return left;
};

export const addSummoner = (Summoners, userData) => {
  const compareFn = (a, b) => a.slotId - b.slotId;
  const index = binarySearchInsert(Summoners, userData, compareFn);
  const newSummoners = [...Summoners];
  if (index < newSummoners.length && newSummoners[index].slotId === userData.slotId) {
    // 如果找到相同的 slotId，替換原有的數據
    newSummoners[index] = userData;
  } else {
    // 否則，將新數據插入到正確的位置
    newSummoners.splice(index, 0, userData);
  }
  return newSummoners;
};

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
    gamePhase: state.GameReducer.gamePhase
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