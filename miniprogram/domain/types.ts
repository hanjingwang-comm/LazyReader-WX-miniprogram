export type ArticleType = "article" | "image-ocr" | "pdf";
export type OcrStatus = "none" | "queued" | "processing" | "draft" | "confirmed" | "error";
export type ReadingStatus = "reading" | "finished" | "rereading";
export type SyncStatus = "local" | "syncing" | "synced" | "pending" | "error";

export interface EditorDelta {
  ops: Array<Record<string, unknown>>;
}

export interface AssetRef {
  fileId?: string;
  localPath?: string;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
}

export interface SourceFile extends AssetRef {
  hidden: true;
}

export interface OcrState {
  status: OcrStatus;
  fullText: string;
  highlightedText: string;
  confidence: number | null;
  error: string;
  updatedAt: number | null;
}

export interface Article {
  id: string;
  bookId?: string;
  type: ArticleType;
  title: string;
  excerpt: string;
  folderId: string;
  tagIds: string[];
  favorite: boolean;
  contentDelta: EditorDelta;
  contentHtml: string;
  contentText: string;
  draftContentDelta?: EditorDelta;
  draftContentHtml?: string;
  draftContentText?: string;
  sourceFile?: SourceFile;
  embeddedAssets: AssetRef[];
  ocr: OcrState;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Tag {
  id: string;
  name: string;
  colorId: TagColorId;
  createdAt: number;
  updatedAt: number;
}

export type TagColorId = "butter" | "forest" | "cobalt" | "mist" | "sage" | "stone";

export interface Book {
  id: string;
  title: string;
  author: string;
  totalPages: number;
  stickerId: number;
  stampIconId: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReadingLog {
  id: string;
  bookId?: string;
  startPage?: number;
  endPage?: number;
  date: string;
  bookTitle: string;
  pages: number;
  minutes: number;
  status: ReadingStatus;
  stickerId: number;
  stampIconId: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface UserSettings {
  id: string;
  monthlyReadingGoal: number;
  seedVersion: number;
  createdAt: number;
  updatedAt: number;
}

export type EntityCollection = "articles" | "folders" | "tags" | "books" | "reading_logs" | "user_settings";

export interface PendingMutation {
  id: string;
  collection: EntityCollection;
  action: "upsert" | "delete";
  entityId: string;
  baseRevision: number;
  payload?: Record<string, unknown>;
  queuedAt: number;
}

export interface RepositoryState {
  books: Book[];
  articles: Article[];
  folders: Folder[];
  tags: Tag[];
  readingLogs: ReadingLog[];
  settings: UserSettings;
  pendingMutations: PendingMutation[];
  collapsedFolderIds: string[];
  syncStatus: SyncStatus;
  initialized: boolean;
}

export interface OcrResult {
  status: "draft" | "error";
  fullText: string;
  highlightedText: string;
  confidence: number | null;
  error?: string;
}

export interface BookStamp extends ReadingLog {
  resolvedIconId: number;
}
