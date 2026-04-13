export const REQUEST_TABS = ["params", "headers", "body", "auth", "options"] as const;

export const RESPONSE_TABS = ["body", "headers", "cookies"] as const;

export const SIDEBAR_TABS = ["collections", "history"] as const;

export const DIRTY_TAB_DECISIONS = ["save", "discard", "cancel"] as const;

export const FILE_TREE_INITIAL_EXPANSION_DEPTH = 2;

export const isRequestTab = (value: string): value is (typeof REQUEST_TABS)[number] =>
  REQUEST_TABS.includes(value as (typeof REQUEST_TABS)[number]);

export const isResponseTab = (value: string): value is (typeof RESPONSE_TABS)[number] =>
  RESPONSE_TABS.includes(value as (typeof RESPONSE_TABS)[number]);

export const isSidebarTab = (value: string): value is (typeof SIDEBAR_TABS)[number] =>
  SIDEBAR_TABS.includes(value as (typeof SIDEBAR_TABS)[number]);
