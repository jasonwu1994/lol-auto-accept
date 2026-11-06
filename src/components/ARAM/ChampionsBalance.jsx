import ChampionTable from '../common/ChampionTable';
import {Popover, Button, Input} from '@heroui/react';
import {orderBalanceRows} from '../common/balanceOrder';
import useChampionData from '../../hooks/useChampionData';
import React, {useState, useEffect, useRef, useMemo} from 'react';
import {SearchOutlined} from '@ant-design/icons';
import {message} from '../common/Controls';
import {useTranslation} from 'react-i18next';
import {trackEvent} from '../GoogleAnalytics';
import ApiUtils from "../../api/api-utils";
import {connect} from "react-redux";
import withErrorBoundary from "../error/withErrorBoundary";
import ChampionImage from "../common/ChampionImage";

import {desktop,perform,reportError} from '../../desktop/tauri';


const handleClickLink = (event, url) => {
  event.preventDefault();
  perform(desktop.invoke('open_external',{url}));
}

const ChampionsBalance = (props) => {
  useChampionData();
  const [championsBalance, setChampionsBalance] = useState({});
  const sortedDataSource = useMemo(
    () => orderBalanceRows(championsBalance?.total_aram_balance, props.champSelectSession),
    [championsBalance, props.champSelectSession]
  );
  const [messageApi, contextHolder] = message.useMessage();

  const {t} = useTranslation();
  const greenColor = 'var(--success-soft-foreground)';
  const redColor = 'var(--danger-soft-foreground)';
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

    desktop.invoke('write_clipboard',{text:transformedRecord})
      .then(() => {
        const s = (<>{t('common.copy_success')} {ApiUtils.getChampionNameById(record.champion_id)}</>)

        messageApi.open({
          type: 'success',
          content: s,
        })
      })
      .catch((err) => {
        console.error('Failed to copy:', err);
        const s = (<>{t('common.copy_failure')} {ApiUtils.getChampionNameById(record.champion_id)}</>)

        messageApi.open({
          type: 'error',
          content: s,
        })
      });
  };

  // 表格搜尋
  const searchInput = useRef(null);
  const focusTimer = useRef(null);
  const [filterVisible, setFilterVisible] = useState(false); // 控制篩選框顯示狀態

  const [search, setSearch] = useState('');
  useEffect(()=>{if(!search.trim())return;const timer=setTimeout(()=>trackEvent('search_used',{feature:'balance'}),600);return ()=>clearTimeout(timer);},[search]);

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
        clearTimeout(focusTimer.current);
        focusTimer.current = setTimeout(() => {
          if (searchInput.current) {
            searchInput.current.focus();
            const end = searchInput.current.value.length;
            searchInput.current.setSelectionRange(end, end);
          }
        }, 100);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer.current);
      window.removeEventListener('keydown', handleKeyDown); // 清除事件監聽
    };
  }, []);

  // 初始化平衡調整數據
  useEffect(() => {
    let active = true;
    let pending = false;
    const fetchData = async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await ApiUtils.getChampionsBalanceByCache();
        if (active) setChampionsBalance(previous =>
          JSON.stringify(previous) === JSON.stringify(data) ? previous : data);
      } catch (error) {
        if (active) reportError(error);
      } finally {
        pending = false;
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 60 * 60 * 1000);
    return () => {active = false; clearInterval(interval);};
  }, []);

  const columns = [
    {
      title: (
        <a href="" target="_blank" rel="noopener noreferrer"
           onClick={(event) => {
             handleClickLink(event, 'https://www.deeplol.gg/balance/aram/all')
             trackEvent('external_link_opened', {
               target: 'deeplol'
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
      title: <span>{t('aram.champion')} <Popover isOpen={filterVisible} onOpenChange={setFilterVisible}>
        <Button size="sm" variant="tertiary" isIconOnly aria-label={t('aram.searchChampions')}><SearchOutlined/></Button>
        <Popover.Content><Popover.Dialog className="balance-search"><Input ref={searchInput} autoFocus aria-label={t('aram.searchChampions')}
          placeholder="Ctrl+F" value={search} onChange={event => setSearch(event.target.value)}
          onKeyDown={event => {if (event.key === 'Enter' || event.key === 'Escape') setFilterVisible(false);}}/>
        </Popover.Dialog></Popover.Content>
      </Popover></span>,
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
      <ChampionTable label={t('aram.balanceTab')} compact
        rowKey="champion_id" columns={columns}
        rows={sortedDataSource.filter(record => ApiUtils.getChampionNameById(record.champion_id).toLowerCase().includes(search.toLowerCase()))}/>
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

