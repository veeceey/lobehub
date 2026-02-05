import debug from 'debug';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { mutate } from '@/libs/swr';
import { userService } from '@/services/user';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import type { ToolStore } from '../../store';
import { invokeExecutor } from './executors/index';
import type { BuiltinToolContext, BuiltinToolResult } from './types';

const n = setNamespace('builtinTool');
const log = debug('lobe-store:builtin-tool');

const INSTALLED_BUILTIN_TOOLS = 'loadInstalledBuiltinTools';

/**
 * Builtin Tool Action Interface
 */

type Setter = StoreSetter<ToolStore>;
export const createBuiltinToolSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new BuiltinToolActionImpl(set, get, _api);

export class BuiltinToolActionImpl {
  readonly #get: () => ToolStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  invokeBuiltinTool = async (
    identifier: string,
    apiName: string,
    params: any,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const executorKey = `${identifier}/${apiName}`;
    log('invokeBuiltinTool: %s', executorKey);

    const { toggleBuiltinToolLoading } = this.#get();
    toggleBuiltinToolLoading(executorKey, true);

    try {
      const result = await invokeExecutor(identifier, apiName, params, ctx);
      log('invokeBuiltinTool result: %s -> %o', executorKey, result);

      toggleBuiltinToolLoading(executorKey, false);
      return result;
    } catch (error) {
      log('invokeBuiltinTool error: %s -> %o', executorKey, error);
      toggleBuiltinToolLoading(executorKey, false);

      return {
        error: {
          body: error,
          message: error instanceof Error ? error.message : String(error),
          type: 'BuiltinToolExecutorError',
        },
        success: false,
      };
    }
  };

  toggleBuiltinToolLoading = (key: string, value: boolean): void => {
    this.#set({ builtinToolLoading: { [key]: value } }, false, n('toggleBuiltinToolLoading'));
  };

  transformApiArgumentsToAiState = async (
    key: string,
    params: any,
  ): Promise<string | undefined> => {
    const { builtinToolLoading, toggleBuiltinToolLoading } = this.#get();
    if (builtinToolLoading[key]) return;

    const { [key as keyof BuiltinToolAction]: action } = this.#get();

    if (!action) return JSON.stringify(params);

    toggleBuiltinToolLoading(key, true);

    try {
      // @ts-ignore
      const result = await action(params);

      toggleBuiltinToolLoading(key, false);

      return JSON.stringify(result);
    } catch (e) {
      toggleBuiltinToolLoading(key, false);
      throw e;
    }
  };

  // ========== Installed Builtin Tools Management ==========

  /**
   * Install a builtin tool by adding it to the installed list
   */
  installBuiltinTool = async (identifier: string): Promise<void> => {
    const currentInstalled = this.#get().installedBuiltinTools;

    if (currentInstalled.includes(identifier)) return;

    const newInstalled = [...currentInstalled, identifier];

    // Optimistic update
    this.#set({ installedBuiltinTools: newInstalled }, false, n('installBuiltinTool'));

    // Persist to user settings
    await userService.updateUserSettings({
      tool: { installedBuiltinTools: newInstalled },
    });

    // Refresh to ensure consistency
    await this.refreshInstalledBuiltinTools();
  };

  /**
   * Uninstall a builtin tool by removing it from the installed list
   */
  uninstallBuiltinTool = async (identifier: string): Promise<void> => {
    const currentInstalled = this.#get().installedBuiltinTools;

    if (!currentInstalled.includes(identifier)) return;

    const newInstalled = currentInstalled.filter((id) => id !== identifier);

    // Optimistic update
    this.#set({ installedBuiltinTools: newInstalled }, false, n('uninstallBuiltinTool'));

    // Persist to user settings
    await userService.updateUserSettings({
      tool: { installedBuiltinTools: newInstalled },
    });

    // Refresh to ensure consistency
    await this.refreshInstalledBuiltinTools();
  };

  /**
   * Refresh installed builtin tools from server
   */
  refreshInstalledBuiltinTools = async (): Promise<void> => {
    await mutate(INSTALLED_BUILTIN_TOOLS);
  };

  /**
   * SWR hook to fetch installed builtin tools
   */
  useFetchInstalledBuiltinTools = (enabled: boolean): SWRResponse<string[]> => {
    return useSWR<string[]>(
      enabled ? INSTALLED_BUILTIN_TOOLS : null,
      async () => {
        const userState = await userService.getUserState();
        return userState?.settings?.tool?.installedBuiltinTools || [];
      },
      {
        fallbackData: [],
        onSuccess: (data) => {
          this.#set(
            { installedBuiltinTools: data, installedBuiltinToolsLoading: false },
            false,
            n('useFetchInstalledBuiltinTools'),
          );
        },
        revalidateOnFocus: false,
      },
    );
  };
}

export type BuiltinToolAction = Pick<BuiltinToolActionImpl, keyof BuiltinToolActionImpl>;
