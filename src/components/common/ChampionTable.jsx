import {trackEvent} from '../../analytics/client';
import React, {useState} from 'react';
import {Table, Checkbox} from '@heroui/react';
import {useTranslation} from 'react-i18next';

export default function ChampionTable({columns, rows, rowKey, selection, label, compact = false, maxHeight}) {
  const {t} = useTranslation();
  const [sort, setSort] = useState();
  const column = columns.find((c, index) => String(index) === sort?.column);
  const ordered = column?.sorter ? [...rows].sort((a,b) => column.sorter(a,b) * (sort.direction === 'descending' ? -1 : 1)) : rows;
  const disabledKeys = selection ? rows.filter(selection.disabled).map(row => row[rowKey]) : [];
  return <Table className={`aram-table${compact ? ' balance-table' : ''}`}>
    <Table.ScrollContainer style={{maxHeight}}>
      <Table.Content aria-label={label} sortDescriptor={sort} onSortChange={next => {const value=sort?.column === next.column && sort.direction === 'descending' ? undefined : next;setSort(value);trackEvent('sort_changed',{column_index:Number(next.column),direction:value?.direction??'none'});}}
        selectionMode={selection ? 'multiple' : 'none'} selectedKeys={selection?.keys}
        disabledKeys={disabledKeys} disabledBehavior="selection"
        onSelectionChange={selection ? keys => selection.onChange(keys === 'all' ? rows.filter(row => !selection.disabled(row)).map(row => row[rowKey]) : [...keys]) : undefined}>
        <Table.Header>
          {selection && <Table.Column><Checkbox aria-label={t('aram.selectAll')} slot="selection"><Checkbox.Content><Checkbox.Control><Checkbox.Indicator/></Checkbox.Control></Checkbox.Content></Checkbox></Table.Column>}
          {columns.map((column,index) => <Table.Column key={index} id={String(index)} isRowHeader={index === 1} allowsSorting={Boolean(column.sorter)}>
            {({sortDirection}) => column.sorter ? <Table.SortableColumnHeader sortDirection={sortDirection}>{column.title}</Table.SortableColumnHeader> : column.title}
          </Table.Column>)}
        </Table.Header>
        <Table.Body>{ordered.map(row => <Table.Row key={row[rowKey]} id={row[rowKey]} data-self={row.isSelf || undefined}>
          {selection && <Table.Cell><Checkbox aria-label={`${t('aram.selectChampion')} ${selection.name(row)}`} slot="selection"><Checkbox.Content><Checkbox.Control><Checkbox.Indicator/></Checkbox.Control></Checkbox.Content></Checkbox></Table.Cell>}
          {columns.map((column,index) => <Table.Cell key={index}>{column.render ? column.render(row[column.dataIndex],row) : row[column.dataIndex]}</Table.Cell>)}
        </Table.Row>)}</Table.Body>
      </Table.Content>
    </Table.ScrollContainer>
  </Table>;
}
