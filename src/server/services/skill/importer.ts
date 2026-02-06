import { type LobeChatDatabase } from '@lobechat/database';
import {
  type CreateSkillInput,
  type ImportGitHubInput,
  type ImportZipInput,
  type SkillManifest,
} from '@lobechat/types';
import debug from 'debug';
import { readFile } from 'node:fs/promises';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { GitHub, GitHubNotFoundError, GitHubParseError } from '@/server/modules/GitHub';
import { FileService } from '@/server/services/file';

import { SkillImportError } from './errors';
import { SkillParser } from './parser';
import { SkillResourceService } from './resource';

const log = debug('lobe-chat:service:skill-importer');

export class SkillImporter {
  private skillModel: AgentSkillModel;
  private parser: SkillParser;
  private resourceService: SkillResourceService;
  private fileService: FileService;
  private github: GitHub;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.skillModel = new AgentSkillModel(db, userId);
    this.parser = new SkillParser();
    this.resourceService = new SkillResourceService(db, userId);
    this.fileService = new FileService(db, userId);
    this.github = new GitHub({ userAgent: 'LobeHub-Skill-Importer' });
    this.userId = userId;
  }

  /**
   * Create a skill manually by user
   */
  async createUserSkill(input: CreateSkillInput) {
    const identifier = input.identifier || `user.${this.userId}.${Date.now()}`;

    // Check if identifier already exists
    const existing = await this.skillModel.findByIdentifier(identifier);
    if (existing) {
      throw new SkillImportError(
        `Skill with identifier "${identifier}" already exists`,
        'CONFLICT',
      );
    }

    const manifest: SkillManifest = {
      description: input.description || '',
      name: input.name,
    };

    return this.skillModel.create({
      content: input.content,
      description: input.description,
      identifier,
      manifest,
      name: input.name,
      source: 'user',
    });
  }

  /**
   * Import skill from ZIP file
   * @param input - Contains zipFileId from files table
   */
  async importFromZip(input: ImportZipInput) {
    log('importFromZip: starting with zipFileId=%s', input.zipFileId);

    // 1. Download ZIP file to local
    const { filePath, cleanup } = await this.fileService.downloadFileToLocal(input.zipFileId);
    log('importFromZip: downloaded to filePath=%s', filePath);

    try {
      const buffer = await readFile(filePath);
      log('importFromZip: read buffer size=%d bytes', buffer.length);

      // 2. Parse ZIP package
      const { manifest, content, resources, zipHash } = await this.parser.parseZipPackage(buffer);
      log(
        'importFromZip: parsed manifest=%o, resources count=%d, zipHash=%s',
        manifest,
        resources.size,
        zipHash,
      );

      // 3. Store resource files
      const resourceIds = zipHash
        ? await this.resourceService.storeResources(zipHash, resources)
        : {};
      log('importFromZip: stored resources=%o', resourceIds);

      // 4. Generate identifier
      const identifier = `import.${this.userId}.${Date.now()}`;
      log('importFromZip: generated identifier=%s', identifier);

      // 5. Create skill record
      const result = await this.skillModel.create({
        content,
        description: manifest.description,
        identifier,
        manifest,
        name: manifest.name,
        resources: resourceIds,
        source: 'user',
        zipFileHash: zipHash,
      });
      log('importFromZip: created skill id=%s', result.id);
      return result;
    } finally {
      cleanup();
      log('importFromZip: cleaned up temp file');
    }
  }

  /**
   * Import skill from GitHub repository
   * @param input - GitHub repository info
   */
  async importFromGitHub(input: ImportGitHubInput) {
    log('importFromGitHub: starting with gitUrl=%s, branch=%s', input.gitUrl, input.branch);

    // 1. Parse GitHub URL
    let repoInfo;
    try {
      repoInfo = this.github.parseRepoUrl(input.gitUrl, input.branch);
      log('importFromGitHub: parsed repoInfo=%o', repoInfo);
    } catch (error) {
      log('importFromGitHub: failed to parse URL, error=%s', (error as Error).message);
      if (error instanceof GitHubParseError) {
        throw new SkillImportError(error.message, 'INVALID_URL');
      }
      throw error;
    }

    // 2. Download repository ZIP
    let zipBuffer;
    try {
      log('importFromGitHub: downloading repository ZIP...');
      zipBuffer = await this.github.downloadRepoZip(repoInfo);
      log('importFromGitHub: downloaded ZIP size=%d bytes', zipBuffer.length);
    } catch (error) {
      log('importFromGitHub: download failed, error=%s', (error as Error).message);
      if (error instanceof GitHubNotFoundError) {
        throw new SkillImportError(error.message, 'NOT_FOUND');
      }
      throw new SkillImportError(
        `Failed to download GitHub repository: ${(error as Error).message}`,
        'DOWNLOAD_FAILED',
      );
    }

    // 3. Parse ZIP package (pass basePath for subdirectory imports)
    log('importFromGitHub: parsing ZIP package with basePath=%s', repoInfo.path);
    const { manifest, content, resources, zipHash } = await this.parser.parseZipPackage(zipBuffer, {
      basePath: repoInfo.path,
    });
    log(
      'importFromGitHub: parsed manifest=%o, resources count=%d, zipHash=%s',
      manifest,
      resources.size,
      zipHash,
    );

    // 4. Store resource files
    log('importFromGitHub: storing %d resources...', resources.size);
    const resourceIds = zipHash
      ? await this.resourceService.storeResources(zipHash, resources)
      : {};
    log('importFromGitHub: stored resources=%o', resourceIds);

    // 5. Generate identifier (use GitHub info for uniqueness, include path for subdirectory imports)
    const pathSuffix = repoInfo.path ? `.${repoInfo.path.replaceAll('/', '.')}` : '';
    const identifier = `github.${repoInfo.owner}.${repoInfo.repo}${pathSuffix}`;
    log('importFromGitHub: identifier=%s', identifier);

    // 6. Build manifest with repository info
    const fullManifest: SkillManifest = {
      ...manifest,
      gitUrl: input.gitUrl,
      repository: `https://github.com/${repoInfo.owner}/${repoInfo.repo}`,
    };

    // 7. Upload ZIP file to S3 and create file record (for zipFileHash foreign key)
    let zipFileHash: string | undefined;
    if (zipHash) {
      const zipKey = `skills/zip/${zipHash}.zip`;
      await this.fileService.uploadBuffer(zipKey, zipBuffer, 'application/zip');
      await this.fileService.createFileRecord({
        fileHash: zipHash,
        fileType: 'application/zip',
        name: `${repoInfo.repo}.zip`,
        size: zipBuffer.length,
        url: zipKey,
      });
      zipFileHash = zipHash;
      log('importFromGitHub: uploaded ZIP file, hash=%s', zipFileHash);
    }

    // 8. Check if already exists (support update)
    const existing = await this.skillModel.findByIdentifier(identifier);
    if (existing) {
      log('importFromGitHub: skill already exists, updating id=%s', existing.id);
      // Update existing skill
      const result = await this.skillModel.update(existing.id, {
        content,
        description: manifest.description,
        manifest: fullManifest,
        name: manifest.name,
        resources: resourceIds,
        zipFileHash,
      });
      log('importFromGitHub: updated skill id=%s', result.id);
      return result;
    }

    // 9. Create new skill record
    log('importFromGitHub: creating new skill...');
    const result = await this.skillModel.create({
      content,
      description: (manifest as any).description,
      identifier,
      manifest: fullManifest,
      name: manifest.name,
      resources: resourceIds,
      source: 'market', // GitHub source marked as market
      zipFileHash,
    });
    log('importFromGitHub: created skill id=%s', result.id);
    return result;
  }
}
