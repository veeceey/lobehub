'use client';

import isEqual from 'fast-deep-equal';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

import { DetailContext, type DetailContextValue } from './DetailContext';

interface BuiltinDetailProviderProps {
  children: ReactNode;
  identifier: string;
}

export const BuiltinDetailProvider = ({ children, identifier }: BuiltinDetailProviderProps) => {
  const { t } = useTranslation(['setting']);

  const builtinTools = useToolStore(builtinToolSelectors.metaList, isEqual);

  const toolMeta = useMemo(
    () => builtinTools.find((tool) => tool.identifier === identifier),
    [identifier, builtinTools],
  );

  // Get the full builtin tool data to access API definitions
  const builtinToolsData = useToolStore((s) => s.builtinTools, isEqual);
  const toolData = useMemo(
    () => builtinToolsData.find((tool) => tool.identifier === identifier),
    [identifier, builtinToolsData],
  );

  if (!toolMeta || !toolData) return null;

  const { meta } = toolMeta;
  const { manifest } = toolData;

  // Convert API definitions to tools format
  const tools = (manifest.api || []).map((api) => ({
    description: api.description,
    inputSchema: api.parameters,
    name: api.name,
  }));

  const localizedDescription = t(`tools.builtin.${identifier}.description`, {
    defaultValue: meta?.description || '',
  });
  const localizedIntroduction = t(`tools.builtin.${identifier}.introduction`, {
    defaultValue: meta?.description || '',
  });

  const value: DetailContextValue = {
    author: 'LobeHub',
    authorUrl: 'https://lobehub.com',
    config: null as any, // Builtin tools don't have provider config
    description: meta?.description || '',
    icon: meta?.avatar || '',
    identifier,
    introduction: meta?.description || '',
    isConnected: true, // Builtin tools are always "connected"
    label: meta?.title || identifier,
    localizedDescription,
    localizedIntroduction,
    tools,
    toolsLoading: false,
  };

  return <DetailContext.Provider value={value}>{children}</DetailContext.Provider>;
};
