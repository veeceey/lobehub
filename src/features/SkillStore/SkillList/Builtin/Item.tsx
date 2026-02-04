'use client';

import { ActionIcon, Avatar, Block, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { MoreVerticalIcon, Plus, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

import { itemStyles } from '../style';

interface ItemProps {
  avatar?: string;
  description?: string;
  identifier: string;
  onOpenDetail?: () => void;
  title?: string;
}

const Item = memo<ItemProps>(({ avatar, description, identifier, onOpenDetail, title }) => {
  const { t } = useTranslation('setting');
  const styles = itemStyles;
  const { modal } = App.useApp();

  const [installBuiltinTool, uninstallBuiltinTool, isInstalled] = useToolStore((s) => [
    s.installBuiltinTool,
    s.uninstallBuiltinTool,
    builtinToolSelectors.isBuiltinToolInstalled(identifier)(s),
  ]);

  const handleInstall = async () => {
    await installBuiltinTool(identifier);
  };

  const handleUninstall = () => {
    modal.confirm({
      cancelText: t('cancel', { ns: 'common' }),
      centered: true,
      content: t('tools.builtins.uninstallConfirm.desc', { name: title || identifier }),
      okButtonProps: { danger: true },
      okText: t('tools.builtins.uninstall'),
      onOk: async () => {
        await uninstallBuiltinTool(identifier);
      },
      title: t('tools.builtins.uninstallConfirm.title', { name: title || identifier }),
    });
  };

  const renderAction = () => {
    if (isInstalled) {
      return (
        <DropdownMenu
          items={[
            {
              danger: true,
              icon: <Icon icon={Trash2} />,
              key: 'uninstall',
              label: t('tools.builtins.uninstall'),
              onClick: handleUninstall,
            },
          ]}
          nativeButton={false}
          placement="bottomRight"
        >
          <ActionIcon icon={MoreVerticalIcon} />
        </DropdownMenu>
      );
    }

    return <ActionIcon icon={Plus} onClick={handleInstall} title={t('tools.builtins.install')} />;
  };

  return (
    <Block
      align={'center'}
      className={styles.container}
      gap={12}
      horizontal
      onClick={onOpenDetail}
      paddingBlock={12}
      paddingInline={12}
      style={{ cursor: 'pointer' }}
      variant={'outlined'}
    >
      <Avatar avatar={avatar} size={40} style={{ marginInlineEnd: 0 }} />
      <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
        <span className={styles.title}>{title || identifier}</span>
        {description && <span className={styles.description}>{description}</span>}
      </Flexbox>
      <div onClick={(e) => e.stopPropagation()}>{renderAction()}</div>
    </Block>
  );
});

Item.displayName = 'BuiltinListItem';

export default Item;
