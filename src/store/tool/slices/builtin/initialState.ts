import type {LobeBuiltinTool} from '@lobechat/types';

import { builtinTools } from '@/tools';

export interface BuiltinToolState {
  builtinToolLoading: Record<string, boolean>;
  builtinTools: LobeBuiltinTool[];
  /**
   * List of installed builtin tool identifiers
   * Empty array means no builtin tools are installed (default)
   */
  installedBuiltinTools: string[];
  /**
   * Loading state for fetching installed builtin tools
   */
  installedBuiltinToolsLoading: boolean;
}

export const initialBuiltinToolState: BuiltinToolState = {
  builtinToolLoading: {},
  builtinTools,
  installedBuiltinTools: [],
  installedBuiltinToolsLoading: true,
};
