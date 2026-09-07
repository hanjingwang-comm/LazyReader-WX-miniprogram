declare const wx: any;
interface MiniProgramInstance {
  data: Record<string, any>;
  setData(data: Record<string, any>, callback?: () => void): void;
  getTabBar?(): any;
  selectComponent?(selector: string): any;
}

declare function App<T extends Record<string, any>>(options: T & ThisType<T>): void;
declare function Page<T extends Record<string, any>>(options: T & ThisType<T & MiniProgramInstance>): void;
declare function Component<T extends Record<string, any>>(options: T & ThisType<T & MiniProgramInstance>): void;
declare function getApp<T = any>(): T;
declare function getCurrentPages(): any[];

interface AppGlobalData {
  repositoryReady: Promise<void>;
  checkinBookId?: string;
}

interface LazyReaderApp {
  globalData: AppGlobalData;
}
