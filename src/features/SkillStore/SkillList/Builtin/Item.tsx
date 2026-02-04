'use client';

import { Avatar, Block, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { itemStyles } from '../style';

interface ItemProps {
  avatar?: string;
  description?: string;
  identifier: string;
  onOpenDetail?: () => void;
  title?: string;
}

const Item = memo<ItemProps>(({ avatar, description, identifier, onOpenDetail, title }) => {
  const styles = itemStyles;

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
    </Block>
  );
});

Item.displayName = 'BuiltinListItem';

export default Item;
