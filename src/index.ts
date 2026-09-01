// Re-export all types consumers might need
export type { AliasEntry } from "./core/aliases.js";
export type { BaseQueryResult, BaseView } from "./core/bases.js";
export type { Bookmark } from "./core/bookmarks.js";
export type { Canvas, CanvasEdge, CanvasNode } from "./core/canvas.js";
export type {
  CreateOptions,
  CreateResult,
  DeleteResult,
  MoveResult,
  ReadResult,
} from "./core/crud.js";
export type { FileInfo, FolderInfo } from "./core/files.js";
export type {
  AddTemplateResult,
  ScaffoldResult,
  TemplateInfo,
} from "./core/init.js";
export type {
  OverviewFolder,
  OverviewOptions,
  VaultOverview,
} from "./core/overview.js";
export type { SearchOptions, SearchResult } from "./core/search.js";
export type { TagInfo } from "./core/tags.js";
export type { TaskShowResult, TaskWithFile } from "./core/tasks.js";
export type { VaultMetadata } from "./core/vault.js";
export type { WordCount } from "./core/wordcount.js";
export { Napkin } from "./sdk.js";
export type { VaultTemplate } from "./templates/types.js";
export type { NapkinConfig, VaultLayout } from "./utils/config.js";
export { DEFAULT_CONFIG, SIBLING_VAULT_LAYOUT } from "./utils/config.js";
export type { Heading } from "./utils/markdown.js";
export type { VaultInfo } from "./utils/vault.js";
