export interface AppConfig {
  schemaVersion?: number;
  isAutoAccept: boolean;
  isShowRecentTeammate: boolean;
  recentTeammateCheckGameCount: number;
  isCheckHiddenPlayerHistory: boolean;
  hiddenPlayerHistoryGameCount: number;
  isShowTeammateRanked: boolean;
  showTeammateRankedType: string;
  isHovercard: boolean;
  hovercardTierType: string;
  hovercardRankedType: string;
  language: 'zh' | 'en';
  isDarkMode: boolean;
  designTheme?: string;
  appearanceMode?: 'light' | 'dark' | 'system' | null;
  alwaysOnTop?: boolean;
  isAutoAramTopmost?: boolean;
  windowSize?: {width: number; height: number} | null;
  windowPosition?: {x: number; y: number} | null;
  navOrder?: string[];
}
export interface AppSnapshot {
  appVersion: string;
  config: AppConfig;
  configRevision: number;
  connection: string;
  connectionGeneration: number;
  sessionKey: string | null;
  revision: number;
  gameflowSession: any;
  champSelectSession: any;
  currentSummoner: any;
  lobbyMembers: any;
  phase: string;
  aramPreferences: number[];
}
export interface SessionIntent { connectionGeneration: number; sessionKey: string | null }
export interface OperationError { code: string; message: string }
