import { type LobeChatDatabase } from '@lobechat/database';
import { type SkillResourceTreeNode } from '@lobechat/types';
import { sha256 } from 'js-sha256';
import mime from 'mime';

import { FileModel } from '@/database/models/file';
import { FileService } from '@/server/services/file';

import { SkillResourceError } from './errors';

export class SkillResourceService {
  private fileModel: FileModel;
  private fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.fileService = new FileService(db, userId);
    this.fileModel = new FileModel(db, userId);
  }

  /**
   * Store resource files to S3/files table
   * Uses zipHash as path prefix for deduplication
   *
   * @param zipHash - ZIP package hash for deduplication
   * @param resources - Resource file mapping Map<VirtualPath, Buffer>
   */
  async storeResources(
    zipHash: string,
    resources: Map<string, Buffer>,
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const [virtualPath, buffer] of resources) {
      const fileId = await this.storeResource(zipHash, virtualPath, buffer);
      result[virtualPath] = fileId;
    }

    return result;
  }

  /**
   * Read resource file content
   */
  async readResource(resourceIds: Record<string, string>, virtualPath: string): Promise<string> {
    const key = await this.getResourceKey(resourceIds, virtualPath);
    return this.fileService.getFileContent(key);
  }

  /**
   * Build resource directory tree structure
   */
  listResources(resourceIds: Record<string, string>): SkillResourceTreeNode[] {
    return this.buildTree(Object.keys(resourceIds));
  }

  // ===== Private Methods =====

  private async storeResource(
    zipHash: string,
    virtualPath: string,
    buffer: Buffer,
  ): Promise<string> {
    // Use zipHash as path prefix, same ZIP resources share same path
    const key = `skills/${zipHash}/${virtualPath}`;

    // Upload to S3
    await this.fileService.uploadMedia(key, buffer);

    // Create file record (handles globalFiles deduplication internally)
    const { fileId } = await this.fileService.createFileRecord({
      fileHash: sha256(buffer),
      fileType: mime.getType(virtualPath) || 'application/octet-stream',
      name: virtualPath.split('/').pop() || virtualPath,
      size: buffer.length,
      url: key,
    });

    return fileId;
  }

  private async getResourceKey(
    resourceIds: Record<string, string>,
    virtualPath: string,
  ): Promise<string> {
    const fileId = resourceIds[virtualPath];
    if (!fileId) {
      throw new SkillResourceError(`Resource not found: ${virtualPath}`);
    }

    const file = await this.fileModel.findById(fileId);
    if (!file) {
      throw new SkillResourceError(`File record not found: ${fileId}`);
    }

    return file.url;
  }

  private buildTree(paths: string[]): SkillResourceTreeNode[] {
    const root: SkillResourceTreeNode[] = [];
    const nodeMap = new Map<string, SkillResourceTreeNode>();

    for (const path of [...paths].sort()) {
      const parts = path.split('/');
      let currentPath = '';
      let currentLevel = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        let node = nodeMap.get(currentPath);
        if (!node) {
          node = {
            children: isFile ? undefined : [],
            name: part,
            path: currentPath,
            type: isFile ? 'file' : 'directory',
          };
          nodeMap.set(currentPath, node);
          currentLevel.push(node);
        }

        if (!isFile && node.children) {
          currentLevel = node.children;
        }
      }
    }

    return root;
  }
}
