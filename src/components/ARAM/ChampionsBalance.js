import React, {useState, useEffect, useRef} from 'react';
import {SearchOutlined} from '@ant-design/icons';
import styled from 'styled-components';
import {Table, Input, message} from "antd";
import {useTranslation} from 'react-i18next';
import {trackEvent} from '../GoogleAnalytics';
import ApiUtils from "../../api/api-utils";
import {connect} from "react-redux";
import withErrorBoundary from "../error/withErrorBoundary";
import ChampionImage from "../common/ChampionImage";

const {ipcRenderer} = window.require('electron');


// 降低表格每列的高
const CustomTable = styled.div`
    .ant-table-cell {
        padding-top: 1px !important;
        padding-bottom: 1px !important;
        //padding-left: 16px !important;
        //padding-right: 16px !important;
    }
`;

const handleClickLink = (event, url) => {
  event.preventDefault();
  ipcRenderer.send('open-link', url);
}

const ChampionsBalance = (props) => {
  const [championsBalance, setChampionsBalance] = useState({});
  const [sortedDataSource, setSortedDataSource] = useState([]);
  const previousChampionIdsRef = useRef([]);
  const [messageApi, contextHolder] = message.useMessage();

  const {t} = useTranslation();
  const greenColor = '#1CA484';
  const redColor = '#E96767';
  const fontSize = '14px';
  const fontWeight = 'bold';

  const handleCopyName = (record) => {
    const fields = [
      {label: t('aram.balance.damage_dealt'), value: record.damage_dealt, showPercentage: true},
      {label: t('aram.balance.damage_taken'), value: record.damage_taken, showPercentage: true},
      {label: t('aram.balance.healing'), value: record.healing, showPercentage: true},
      {label: t('aram.balance.shield_mod'), value: record.shield_mod, showPercentage: true},
      {label: t('aram.balance.tenacity'), value: record.tenacity, showPercentage: false},
      {label: t('aram.balance.energy_regeneration'), value: record.energy_regeneration, showPercentage: true},
      {label: t('aram.balance.ability_haste'), value: record.ability_haste, showPercentage: false},
      {label: t('aram.balance.attack_speed_scaling'), value: record.attack_speed_scaling, showPercentage: true}
    ];

    // 過濾掉數值為 0 的欄位
    const filteredFields = fields.filter(field => field.value !== 0);

    // 構造字符串
    const transformedRecord = `${ApiUtils.getChampionNameById(record.champion_id)}\n` +
      filteredFields.map(field => `${field.label}: ${formatValue(field.value, field.showPercentage)}`).join('\n');

    navigator.clipboard.writeText(transformedRecord)
      .then(() => {
        console.log('Transformed data copied to clipboard:\n', transformedRecord);
        const s = (<>{t('common.copy_success')} {ApiUtils.getChampionNameById(record.champion_id)}</>)
        trackEvent('aram_balance_copy_success', {champion_id: record.champion_id})
        messageApi.open({
          type: 'success',
          content: s,
        })
      })
      .catch((err) => {
        console.error('Failed to copy:', err);
        const s = (<>{t('common.copy_failure')} {ApiUtils.getChampionNameById(record.champion_id)}</>)
        trackEvent('aram_balance_copy_failure', {champion_id: record.champion_id})
        messageApi.open({
          type: 'error',
          content: s,
        })
      });
  };

  // 表格搜尋
  const searchInput = useRef(null);
  const [filterVisible, setFilterVisible] = useState(false); // 控制篩選框顯示狀態

  const getColumnSearchProps = (dataIndex) => ({
    filterDropdown: ({setSelectedKeys, selectedKeys, confirm, clearFilters, close}) => (
      <div style={{padding: 8,}} onKeyDown={(e) => e.stopPropagation()}>
        <Input
          ref={searchInput}
          placeholder={`Ctrl+F`}
          value={selectedKeys[0]}
          onChange={(e) => {
            setSelectedKeys(e.target.value ? [e.target.value] : []);
            confirm({
              closeDropdown: false,
            });
          }}
          onPressEnter={() => confirm()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              confirm(); // 當按下 Esc 鍵時確認並關閉篩選框
            }
          }}
          style={{marginBottom: 8, display: 'block', width: '150px'}}
        />
      </div>
    ),
    filterDropdownOpen: filterVisible, // 控制篩選框顯示
    filterIcon: (filtered) => (
      <SearchOutlined
        style={{
          color: filtered ? '#1677ff' : undefined,
        }}
      />
    ),
    onFilter: (value, record) => {
      const championName = ApiUtils.getChampionNameById(record[dataIndex]);
      return championName.toLowerCase().includes(value.toLowerCase());
    },
    onFilterDropdownOpenChange: (visible) => {
      console.log('visible:', visible)
      setFilterVisible(visible); // 讓篩選框狀態與 `filterVisible` 同步
      if (visible) {
        // 聚焦而不選取全部文字
        setTimeout(() => {
          if (searchInput.current) {
            searchInput.current.focus({
              cursor: 'end', // 讓光標在文字末尾
            });
          }
        }, 100);
      }
    },
  });


  // 表格數據上色+格式化
  const renderValueColor = (value, isPositiveGreen = true, showPercentage = true) => {
    const positiveColor = isPositiveGreen ? greenColor : redColor;
    const negativeColor = isPositiveGreen ? redColor : greenColor;
    const displayValue = formatValue(value, showPercentage);
    return value === 0 ? null : (
      <span style={{
        color: value > 0 ? positiveColor : negativeColor,
        fontWeight: fontWeight,
        fontSize: fontSize
      }}>
      {displayValue}
    </span>
    );
  };

  // 數據格式化函數
  const formatValue = (value, showPercentage = true) => {
    // 根據是否顯示百分比，動態決定要顯示的內容
    const formattedValue = showPercentage
      ? `${value > 0 ? `+${value}` : `${value}`}%` // 如果顯示百分比且為正數，顯示+號和百分比
      : `${value > 0 ? `+${value}` : `${value}`}`; // 不顯示百分比，但顯示正數+號
    return formattedValue;
  };

  // 監聽 Ctrl + F 鍵盤事件
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault(); // 防止默認的瀏覽器行為
        setFilterVisible(true); // 手動打開篩選框
        setTimeout(() => {
          if (searchInput.current) {
            searchInput.current.focus({
              cursor: 'end', // 讓光標在文字末尾
            });
          }
        }, 100);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown); // 清除事件監聽
    };
  }, []);

  // 初始化平衡調整數據
  useEffect(() => {
    const fetchData = async () => {
      const data = await ApiUtils.getChampionsBalanceByCache();
      // 判斷新數據和當前的 championsBalance 是否相同，只有在不同時才更新狀態
      if (JSON.stringify(championsBalance) !== JSON.stringify(data)) {
        setChampionsBalance(data);
      }
    };
    fetchData();

    // 每小時調用一次
    const interval = setInterval(() => {
      fetchData();
    }, 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // 根據隊友的英雄排序
  useEffect(() => {
    // 如果 championsBalance 或 championsBalance.total_aram_balance 不存在，或者 total_aram_balance 長度為 0，則直接 return
    if (!championsBalance || !Array.isArray(championsBalance.total_aram_balance) || championsBalance.total_aram_balance.length === 0) {
      return; // 沒有數據，不顯示或處理
    }

    // 如果沒有 champSelectSession，直接顯示未排序的數據
    if (!props.champSelectSession || (!props.champSelectSession.myTeam && !props.champSelectSession.benchChampions)) {
      console.log('無 champSelectSession，顯示原始數據');
      setSortedDataSource(championsBalance.total_aram_balance);
      return;
    }

    // 校驗 myTeam 和 benchChampions 的存在性和非空性
    const myTeam = props.champSelectSession?.myTeam || [];
    const benchChampions = props.champSelectSession?.benchChampions || [];

    // 提取 myTeam 中的 championId 並根據 cellId 進行排序
    const myTeamChampionIds = myTeam
      .sort((a, b) => a.cellId - b.cellId)
      .map(member => member.championId)
      .filter(championId => championId !== 0);

    // 提取 benchChampions 中的 championId
    const benchChampionIds = benchChampions.map(bench => bench.championId);

    // 如果 myTeam 和 benchChampions 都是空的，直接顯示未排序的數據
    if (myTeamChampionIds.length === 0 && benchChampionIds.length === 0) {
      // console.log('無需排序，顯示原始數據');
      setSortedDataSource(championsBalance.total_aram_balance);
      return;
    }

    // 合併 myTeam 和 benchChampions 的 championId
    const combinedChampionIds = [...myTeamChampionIds, ...benchChampionIds];

    // 判斷此次排序順序是否和上次一樣
    const isSameAsPrevious = JSON.stringify(combinedChampionIds) === JSON.stringify(previousChampionIdsRef.current);

    // 如果順序一樣，直接 return，避免重複排序
    if (isSameAsPrevious) {
      console.log('排序順序與上次相同，跳過排序');
      return;
    }

    // 更新 previousChampionIdsRef.current 的值
    previousChampionIdsRef.current = combinedChampionIds;

    // 先篩選出 championsBalance 中在 combinedChampionIds 的項目，然後根據 combinedChampionIds 的順序進行排序
    const sortedByChampionIds = championsBalance.total_aram_balance
      .filter(item => combinedChampionIds.includes(item.champion_id))
      .sort((a, b) => combinedChampionIds.indexOf(a.champion_id) - combinedChampionIds.indexOf(b.champion_id));

    // 再篩選出不在 combinedChampionIds 中的 champion_id
    const remainingChampions = championsBalance.total_aram_balance
      .filter(item => !combinedChampionIds.includes(item.champion_id));

    // 最終合併已排序的 myTeam + benchChampions 和剩餘的 champions
    const sortedData = [...sortedByChampionIds, ...remainingChampions];

    console.log('準備更新排序: ', sortedData);
    // 更新排序後的數據源
    setSortedDataSource(sortedData);
  }, [props.champSelectSession, championsBalance]);

  const columns = [
    {
      title: (
        <a href="" target="_blank" rel="noopener noreferrer"
           onClick={(event) => {
             handleClickLink(event, 'https://www.deeplol.gg/balance/aram/all')
             trackEvent('click_view_deeplol', {
               version: championsBalance?.version || ''
             })
           }}>
          {championsBalance?.version || ''}
        </a>
      ),
      dataIndex: 'champion_id',
      width: 65,
      render: (text) => (
        <ChampionImage width={40} height={40} championId={text}/>
      ),
    },
    {
      title: t('aram.champion'),
      dataIndex: 'champion_id',
      render: (text, record) => {
        const championName = ApiUtils.getChampionNameById(text);
        return (
          <button
            style={{
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'inherit',
              textDecoration: 'none',
            }}
            title={`Click to copy ${championName}`}
            onClick={() => handleCopyName(record)}
            onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
            onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
          >
            {championName}
          </button>
        );
      },
      ...getColumnSearchProps('champion_id'),
    },
    {
      title: t('aram.balance.damage_dealt'),
      dataIndex: 'damage_dealt',
      sorter: (a, b) => a.damage_dealt - b.damage_dealt,
      render: (value) => renderValueColor(value, true, true),
    },
    {
      title: t('aram.balance.damage_taken'),
      dataIndex: 'damage_taken',
      sorter: (a, b) => a.damage_taken - b.damage_taken,
      render: (value) => renderValueColor(value, false, true),
    },
    {
      title: t('aram.balance.healing'),
      dataIndex: 'healing',
      sorter: (a, b) => a.healing - b.healing,
      render: (value) => renderValueColor(value, true, true),
    },
    {
      title: t('aram.balance.shield_mod'),
      dataIndex: 'shield_mod',
      sorter: (a, b) => a.shield_mod - b.shield_mod,
      render: (value) => renderValueColor(value, true, true),
    },
    {
      title: t('aram.balance.tenacity'),
      dataIndex: 'tenacity',
      sorter: (a, b) => a.tenacity - b.tenacity,
      render: (value) => renderValueColor(value, true, false),
    },
    {
      title: t('aram.balance.energy_regeneration'),
      dataIndex: 'energy_regeneration',
      sorter: (a, b) => a.energy_regeneration - b.energy_regeneration,
      render: (value) => renderValueColor(value, true, true),
    },
    {
      title: t('aram.balance.ability_haste'),
      dataIndex: 'ability_haste',
      sorter: (a, b) => a.ability_haste - b.ability_haste,
      render: (value) => renderValueColor(value, true, false),
    },
    {
      title: t('aram.balance.attack_speed_scaling'),
      dataIndex: 'attack_speed_scaling',
      sorter: (a, b) => a.attack_speed_scaling - b.attack_speed_scaling,
      render: (value) => renderValueColor(value, true, true),
    },
  ];


  return (
    <>
      {contextHolder}
      <CustomTable>
        <Table
          rowKey="champion_id"
          columns={columns}
          dataSource={sortedDataSource}
          pagination={false}
          scroll={{
            y: 400,
          }}
        />
      </CustomTable>
    </>
  );
};

const mapStateToProps = (state) => {
  return {
    champSelectSession: state.GameReducer.champSelectSession,
  }
}

const mapDispatchToProp = {}

export default connect(mapStateToProps, mapDispatchToProp)(withErrorBoundary(ChampionsBalance))

