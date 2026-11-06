import {useSyncExternalStore} from 'react';
import ApiUtils from '../api/api-utils';
export default function useChampionData() {useSyncExternalStore(ApiUtils.subscribeChampions,ApiUtils.championRevision,ApiUtils.championRevision);}
