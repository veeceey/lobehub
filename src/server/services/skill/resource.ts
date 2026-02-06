import { type LobeChatDatabase } from '@lobechat/database';
import { type SkillResourceTreeNode } from '@lobechat/types';
import debug from 'debug';
import { sha256 } from 'js-sha256';
import mime from 'mime';

import { FileModel } from '@/database/models/file';
import { FileService } from '@/server/services/file';

import { SkillResourceError } from './errors';

const log = debug('lobe-chat:service:skill-resource');

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
    log('storeResources: starting with zipHash=%s, resourceCount=%d', zipHash, resources.size);
    const result: Record<string, string> = {};

    for (const [virtualPath, buffer] of resources) {
      log('storeResources: storing resource path=%s, size=%d bytes', virtualPath, buffer.length);
      const fileId = await this.storeResource(zipHash, virtualPath, buffer);
      result[virtualPath] = fileId;
      log('storeResources: stored resource path=%s, fileId=%s', virtualPath, fileId);
    }

    log('storeResources: completed, stored %d resources', Object.keys(result).length);
    return result;
  }

  /**
   * Read resource file content
   */
  async readResource(resourceIds: Record<string, string>, virtualPath: string): Promise<string> {
    log('readResource: reading path=%s, availablePaths=%o', virtualPath, Object.keys(resourceIds));
    const key = await this.getResourceKey(resourceIds, virtualPath);
    log('readResource: resolved key=%s', key);
    const content = await this.fileService.getFileContent(key);
    log('readResource: fetched content length=%d', content.length);
    return content;
  }

  /**
   * Build resource directory tree structure
   */
  listResources(resourceIds: Record<string, string>): SkillResourceTreeNode[] {
    const paths = Object.keys(resourceIds);
    log('listResources: building tree for %d paths', paths.length);
    const tree = this.buildTree(paths);
    log('listResources: built tree with %d root nodes', tree.length);
    return tree;
  }

  // ===== Private Methods =====

  private async storeResource(
    zipHash: string,
    virtualPath: string,
    buffer: Buffer,
  ): Promise<string> {
    // Use zipHash as path prefix, same ZIP resources share same path
    const key = `skills/source_files/${zipHash}/${virtualPath}`;
    log('storeResource: uploading to key=%s', key);

    // Determine content type from file extension
    const fileType = mime.getType(virtualPath) || 'application/octet-stream';

    // Upload to S3 with proper content type (supports any file type, not just images)
    await this.fileService.uploadBuffer(key, buffer, fileType);
    log('storeResource: uploaded to S3 with contentType=%s', fileType);

    // Create file record (handles globalFiles deduplication internally)
    const fileHash = sha256(buffer);
    log('storeResource: creating file record hash=%s, type=%s', fileHash, fileType);

    const { fileId } = await this.fileService.createFileRecord({
      fileHash,
      fileType,
      name: virtualPath.split('/').pop() || virtualPath,
      size: buffer.length,
      url: key,
    });

    log('storeResource: created file record fileId=%s', fileId);
    return fileId;
  }

  private async getResourceKey(
    resourceIds: Record<string, string>,
    virtualPath: string,
  ): Promise<string> {
    log('getResourceKey: looking up path=%s', virtualPath);
    const fileId = resourceIds[virtualPath];
    if (!fileId) {
      log('getResourceKey: resource not found in mapping, path=%s', virtualPath);
      throw new SkillResourceError(`Resource not found: ${virtualPath}`);
    }

    log('getResourceKey: found fileId=%s, fetching file record', fileId);
    const file = await this.fileModel.findById(fileId);
    if (!file) {
      log('getResourceKey: file record not found in DB, fileId=%s', fileId);
      throw new SkillResourceError(`File record not found: ${fileId}`);
    }

    log('getResourceKey: resolved url=%s', file.url);
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
