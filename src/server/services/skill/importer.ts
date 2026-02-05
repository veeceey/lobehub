import { type LobeChatDatabase } from '@lobechat/database';
import {
  type CreateSkillInput,
  type ImportGitHubInput,
  type ImportZipInput,
  type SkillManifest,
} from '@lobechat/types';
import { readFile } from 'node:fs/promises';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { GitHub, GitHubNotFoundError, GitHubParseError } from '@/server/modules/GitHub';
import { FileService } from '@/server/services/file';

import { SkillImportError } from './errors';
import { SkillParser } from './parser';
import { SkillResourceService } from './resource';

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
    // 1. Download ZIP file to local
    const { filePath, cleanup } = await this.fileService.downloadFileToLocal(input.zipFileId);

    try {
      const buffer = await readFile(filePath);

      // 2. Parse ZIP package
      const { manifest, content, resources, zipHash } = await this.parser.parseZipPackage(buffer);

      // 3. Store resource files
      const resourceIds = zipHash
        ? await this.resourceService.storeResources(zipHash, resources)
        : {};

      // 4. Generate identifier
      const identifier = `import.${this.userId}.${Date.now()}`;

      // 5. Create skill record
      return this.skillModel.create({
        content,
        description: manifest.name,
        identifier,
        manifest,
        name: manifest.name,
        resources: resourceIds,
        source: 'user',
        zipFileHash: zipHash,
      });
    } finally {
      cleanup();
    }
  }

  /**
   * Import skill from GitHub repository
   * @param input - GitHub repository info
   */
  async importFromGitHub(input: ImportGitHubInput) {
    // 1. Parse GitHub URL
    let repoInfo;
    try {
      repoInfo = this.github.parseRepoUrl(input.gitUrl, input.branch);
    } catch (error) {
      if (error instanceof GitHubParseError) {
        throw new SkillImportError(error.message, 'INVALID_URL');
      }
      throw error;
    }

    // 2. Download repository ZIP
    let zipBuffer;
    try {
      zipBuffer = await this.github.downloadRepoZip(repoInfo);
    } catch (error) {
      if (error instanceof GitHubNotFoundError) {
        throw new SkillImportError(error.message, 'NOT_FOUND');
      }
      throw new SkillImportError(
        `Failed to download GitHub repository: ${(error as Error).message}`,
        'DOWNLOAD_FAILED',
      );
    }

    // 3. Parse ZIP package
    const { manifest, content, resources, zipHash } = await this.parser.parseZipPackage(zipBuffer);

    // 4. Store resource files
    const resourceIds = zipHash
      ? await this.resourceService.storeResources(zipHash, resources)
      : {};

    // 5. Generate identifier (use GitHub info for uniqueness)
    const identifier = `github.${repoInfo.owner}.${repoInfo.repo}`;

    // 6. Build manifest with repository info
    const fullManifest: SkillManifest = {
      ...manifest,
      gitUrl: input.gitUrl,
      repository: `https://github.com/${repoInfo.owner}/${repoInfo.repo}`,
    };

    // 7. Check if already exists (support update)
    const existing = await this.skillModel.findByIdentifier(identifier);
    if (existing) {
      // Update existing skill
      return this.skillModel.update(existing.id, {
        content,
        description: manifest.name,
        manifest: fullManifest,
        name: manifest.name,
        resources: resourceIds,
        zipFileHash: zipHash,
      });
    }

    // 8. Create new skill record
    return this.skillModel.create({
      content,
      description: manifest.name,
      identifier,
      manifest: fullManifest,
      name: manifest.name,
      resources: resourceIds,
      source: 'market', // GitHub source marked as market
      zipFileHash: zipHash,
    });
  }
}
