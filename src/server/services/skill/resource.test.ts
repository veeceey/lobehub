import { describe, expect, it, vi } from 'vitest';

import { SkillResourceService } from './resource';

// Mock FileService and FileModel
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    createFileRecord: vi.fn().mockResolvedValue({ fileId: 'mock-file-id', url: '/f/mock-file-id' }),
    getFileContent: vi.fn().mockResolvedValue('file content'),
    uploadBuffer: vi.fn().mockResolvedValue({ key: 'mock-key' }),
    uploadMedia: vi.fn().mockResolvedValue({ key: 'mock-key' }),
  })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockResolvedValue({ id: 'mock-file-id', url: 'skills/abc123/test.txt' }),
  })),
}));

describe('SkillResourceService', () => {
  describe('listResources (buildTree)', () => {
    it('should build flat file list', () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resourceIds = {
        'README.md': 'file1',
        'config.json': 'file2',
      };

      const tree = service.listResources(resourceIds);

      expect(tree).toHaveLength(2);
      expect(tree[0]).toEqual({
        children: undefined,
        name: 'README.md',
        path: 'README.md',
        type: 'file',
      });
      expect(tree[1]).toEqual({
        children: undefined,
        name: 'config.json',
        path: 'config.json',
        type: 'file',
      });
    });

    it('should build nested directory structure', () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resourceIds = {
        'lib/utils.ts': 'file1',
        'lib/helpers.ts': 'file2',
        'src/index.ts': 'file3',
      };

      const tree = service.listResources(resourceIds);

      expect(tree).toHaveLength(2);

      // lib directory
      const libDir = tree.find((n) => n.name === 'lib');
      expect(libDir).toBeDefined();
      expect(libDir?.type).toBe('directory');
      expect(libDir?.children).toHaveLength(2);
      expect(libDir?.children?.map((c) => c.name).sort()).toEqual(['helpers.ts', 'utils.ts']);

      // src directory
      const srcDir = tree.find((n) => n.name === 'src');
      expect(srcDir).toBeDefined();
      expect(srcDir?.type).toBe('directory');
      expect(srcDir?.children).toHaveLength(1);
      expect(srcDir?.children?.[0].name).toBe('index.ts');
    });

    it('should build deeply nested structure', () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resourceIds = {
        'a/b/c/d.txt': 'file1',
      };

      const tree = service.listResources(resourceIds);

      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe('a');
      expect(tree[0].type).toBe('directory');
      expect(tree[0].children?.[0].name).toBe('b');
      expect(tree[0].children?.[0].children?.[0].name).toBe('c');
      expect(tree[0].children?.[0].children?.[0].children?.[0].name).toBe('d.txt');
      expect(tree[0].children?.[0].children?.[0].children?.[0].type).toBe('file');
    });

    it('should handle mixed files and directories', () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resourceIds = {
        'README.md': 'file1',
        'lib/index.ts': 'file2',
        'lib/utils/helper.ts': 'file3',
      };

      const tree = service.listResources(resourceIds);

      expect(tree).toHaveLength(2);

      // README.md at root
      const readme = tree.find((n) => n.name === 'README.md');
      expect(readme?.type).toBe('file');

      // lib directory with nested utils
      const lib = tree.find((n) => n.name === 'lib');
      expect(lib?.type).toBe('directory');
      expect(lib?.children).toHaveLength(2);

      const utils = lib?.children?.find((n) => n.name === 'utils');
      expect(utils?.type).toBe('directory');
      expect(utils?.children?.[0].name).toBe('helper.ts');
    });

    it('should handle empty resources', () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const tree = service.listResources({});

      expect(tree).toEqual([]);
    });

    it('should sort paths alphabetically', () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resourceIds = {
        'z.txt': 'file1',
        'a.txt': 'file2',
        'm.txt': 'file3',
      };

      const tree = service.listResources(resourceIds);

      expect(tree.map((n) => n.name)).toEqual(['a.txt', 'm.txt', 'z.txt']);
    });
  });

  describe('storeResources', () => {
    it('should store resources with zipHash prefix', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = new Map([
        ['README.md', Buffer.from('# README')],
        ['lib/utils.ts', Buffer.from('export const util = 1')],
      ]);

      const result = await service.storeResources('abc123hash', resources);

      expect(Object.keys(result)).toHaveLength(2);
      expect(result['README.md']).toBe('mock-file-id');
      expect(result['lib/utils.ts']).toBe('mock-file-id');
    });

    it('should handle empty resources', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = new Map<string, Buffer>();

      const result = await service.storeResources('abc123hash', resources);

      expect(result).toEqual({});
    });
  });

  describe('readResource', () => {
    it('should read resource content', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resourceIds = { 'test.txt': 'file-id-1' };

      const content = await service.readResource(resourceIds, 'test.txt');

      expect(content).toBe('file content');
    });

    it('should throw error for non-existent path', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resourceIds = { 'test.txt': 'file-id-1' };

      await expect(service.readResource(resourceIds, 'non-existent.txt')).rejects.toThrow(
        'Resource not found: non-existent.txt',
      );
    });
  });
});
