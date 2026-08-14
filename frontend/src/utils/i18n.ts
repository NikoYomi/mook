import { useSettings } from '../store/settings'

type Dict = Record<string, string>

const zh: Dict = {
  // 通用
  save: '保存',
  cancel: '取消',
  close: '关闭',
  loading: '正在加载…',
  retry: '重试',
  delete: '删除',
  edit: '编辑',
  search: '搜索',

  // 导航
  servers: '服务器',
  terminal: '终端',
  settings: '设置',
  logout: '退出登录',
  admin: '管理员',
  home: 'Mook 首页',
  addServer: '添加服务器',
  connect: '连接',

  // 设置
  general: '通用设置',
  ai: 'AI 助手',
  data: '数据管理',
  about: '关于',
  appearance: '外观',
  theme: '主题',
  themeDark: '暗色',
  themeLight: '亮色',
  themeSystem: '跟随系统',
  language: '界面语言',
  languageZh: '简体中文',
  languageEn: 'English',

  // 登录
  username: '用户名',
  password: '密码',
  login: '登录',
  loginLoading: '处理中…',

  // 终端
  serverInfo: '服务器信息',
  fileManager: '文件管理',
  commonCommands: '常用命令',
  aiAssistant: 'AI 助手',
  selectServer: '选择服务器',
  noTerminalOpen: '尚未打开任何终端',
  noTerminalDesc: '选择一个服务器开始 SSH 会话，或使用右侧常用命令快速操作',
  newTerminal: '打开新的终端',
  noTerminals: '未打开任何终端',
  connected: '已连接',
  connecting: '连接中…',
  disconnected: '已断开',
}

const en: Dict = {
  save: 'Save',
  cancel: 'Cancel',
  close: 'Close',
  loading: 'Loading…',
  retry: 'Retry',
  delete: 'Delete',
  edit: 'Edit',
  search: 'Search',

  servers: 'Servers',
  terminal: 'Terminal',
  settings: 'Settings',
  logout: 'Log out',
  admin: 'Admin',
  home: 'Mook Home',
  addServer: 'Add Server',
  connect: 'Connect',

  general: 'General',
  ai: 'AI Assistant',
  data: 'Data',
  about: 'About',
  appearance: 'Appearance',
  theme: 'Theme',
  themeDark: 'Dark',
  themeLight: 'Light',
  themeSystem: 'System',
  language: 'Language',
  languageZh: '简体中文',
  languageEn: 'English',

  username: 'Username',
  password: 'Password',
  login: 'Sign in',
  loginLoading: 'Processing…',

  serverInfo: 'Server Info',
  fileManager: 'Files',
  commonCommands: 'Commands',
  aiAssistant: 'AI Assistant',
  selectServer: 'Select Server',
  noTerminalOpen: 'No terminal open',
  noTerminalDesc: 'Pick a server to start an SSH session, or use commands on the right',
  newTerminal: 'Open new terminal',
  noTerminals: 'No terminal open',
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
}

export function useI18n() {
  const english = useSettings((s) => s.english)
  const dict = english ? en : zh
  return (key: string): string => dict[key] ?? zh[key] ?? key
}
