const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)

export const MODIFIER_KEY = IS_MAC_PLATFORM ? 'Cmd' : 'Ctrl'
export const WORKSPACE_SWITCHER_OPEN_EVENT = 'claude-canvas:open-workspace-switcher'

export const FOCUS_NAVIGATOR_SHORTCUT_KEY = 'Shift+F'
export const FOCUS_CANVAS_SHORTCUT_KEY = 'Shift+Space'
export const PLACE_ON_CANVAS_SHORTCUT_KEY = 'Shift+Enter'
export const TREE_EXPAND_SHORTCUT_KEY = '→'
export const TREE_COLLAPSE_SHORTCUT_KEY = '←'
export const TREE_EXPAND_ALL_SHORTCUT_KEY = 'Shift+→'
export const TREE_COLLAPSE_ALL_SHORTCUT_KEY = 'Shift+←'
