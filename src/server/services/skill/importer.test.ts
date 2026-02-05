// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillImportError } from './errors';
import { SkillImporter } from './importer';

// Mock dependencies
vi.mock('@/database/models/agentSkill');
vi.mock('@/server/services/file');
vi.mock('@/server/modules/GitHub');
vi.mock('./parser');
vi.mock('./resource');
vi.mock('node:fs/promises');

const mockSkillModel = {
  create: vi.fn(),
  findByIdentifier: vi.fn(),
  update: vi.fn(),
};

const mockFileService = {
  downloadFileToLocal: vi.fn(),
};

const mockParser = {
  parseZipPackage: vi.fn(),
};

const mockResourceService = {
  storeResources: vi.fn(),
};

const mockGitHub = {
  downloadRepoZip: vi.fn(),
  parseRepoUrl: vi.fn(),
};

describe('SkillImporter', () => {
  let importer: SkillImporter;
  const mockDb = {} as any;
  const mockUserId = 'test-user-id';

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup mocks
    const { AgentSkillModel } = await import('@/database/models/agentSkill');
    (AgentSkillModel as any).mockImplementation(() => mockSkillModel);

    const { FileService } = await import('@/server/services/file');
    (FileService as any).mockImplementation(() => mockFileService);

    const { SkillParser } = await import('./parser');
    (SkillParser as any).mockImplementation(() => mockParser);

    const { SkillResourceService } = await import('./resource');
    (SkillResourceService as any).mockImplementation(() => mockResourceService);

    const { GitHub } = await import('@/server/modules/GitHub');
    (GitHub as any).mockImplementation(() => mockGitHub);

    // Mock fs/promises readFile
    const fs = await import('node:fs/promises');
    (fs.readFile as any).mockResolvedValue(Buffer.from('mock-zip-content'));

    importer = new SkillImporter(mockDb, mockUserId);
  });

  describe('createUserSkill', () => {
    it('should create a user skill with generated identifier', async () => {
      mockSkillModel.findByIdentifier.mockResolvedValue(undefined);
      mockSkillModel.create.mockResolvedValue({
        id: 'skill-1',
        identifier: `user.${mockUserId}.123`,
        name: 'Test Skill',
      });

      const result = await importer.createUserSkill({
        content: '# Test content',
        name: 'Test Skill',
      });

      expect(mockSkillModel.findByIdentifier).toHaveBeenCalled();
      expect(mockSkillModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '# Test content',
          name: 'Test Skill',
          source: 'user',
        }),
      );
      expect(result.name).toBe('Test Skill');
    });

    it('should create a user skill with custom identifier', async () => {
      mockSkillModel.findByIdentifier.mockResolvedValue(undefined);
      mockSkillModel.create.mockResolvedValue({
        id: 'skill-1',
        identifier: 'custom-identifier',
        name: 'Test Skill',
      });

      await importer.createUserSkill({
        content: '# Test content',
        identifier: 'custom-identifier',
        name: 'Test Skill',
      });

      expect(mockSkillModel.findByIdentifier).toHaveBeenCalledWith('custom-identifier');
      expect(mockSkillModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'custom-identifier',
        }),
      );
    });

    it('should throw CONFLICT error when identifier exists', async () => {
      mockSkillModel.findByIdentifier.mockResolvedValue({ id: 'existing-skill' });

      await expect(
        importer.createUserSkill({
          content: '# Test',
          identifier: 'existing-id',
          name: 'Test',
        }),
      ).rejects.toThrow(SkillImportError);

      try {
        await importer.createUserSkill({
          content: '# Test',
          identifier: 'existing-id',
          name: 'Test',
        });
      } catch (e) {
        expect((e as SkillImportError).code).toBe('CONFLICT');
      }
    });
  });

  describe('importFromZip', () => {
    const mockCleanup = vi.fn();

    beforeEach(() => {
      mockFileService.downloadFileToLocal.mockResolvedValue({
        cleanup: mockCleanup,
        file: { name: 'skill.zip' },
        filePath: '/tmp/skill.zip',
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should import skill from ZIP file', async () => {
      mockParser.parseZipPackage.mockResolvedValue({
        content: '# Skill content',
        manifest: { name: 'ZIP Skill' },
        resources: new Map([['readme.md', Buffer.from('readme')]]),
        zipHash: 'abc123',
      });
      mockResourceService.storeResources.mockResolvedValue({ 'readme.md': 'file-id-1' });
      mockSkillModel.create.mockResolvedValue({
        id: 'skill-1',
        name: 'ZIP Skill',
      });

      const result = await importer.importFromZip({ zipFileId: 'zip-file-id' });

      expect(mockFileService.downloadFileToLocal).toHaveBeenCalledWith('zip-file-id');
      expect(mockSkillModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '# Skill content',
          name: 'ZIP Skill',
          source: 'user',
          zipFileHash: 'abc123',
        }),
      );
      expect(mockCleanup).toHaveBeenCalled();
      expect(result.name).toBe('ZIP Skill');
    });

    it('should cleanup even if parsing fails', async () => {
      mockParser.parseZipPackage.mockRejectedValue(new Error('Parse error'));

      await expect(importer.importFromZip({ zipFileId: 'zip-file-id' })).rejects.toThrow();
      expect(mockCleanup).toHaveBeenCalled();
    });
  });

  describe('importFromGitHub', () => {
    it('should import skill from GitHub repository', async () => {
      mockGitHub.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'lobehub',
        repo: 'skill-demo',
      });
      mockGitHub.downloadRepoZip.mockResolvedValue(Buffer.from('mock-zip'));
      mockParser.parseZipPackage.mockResolvedValue({
        content: '# GitHub Skill content',
        manifest: { name: 'GitHub Skill' },
        resources: new Map(),
        zipHash: 'def456',
      });
      mockResourceService.storeResources.mockResolvedValue({});
      mockSkillModel.findByIdentifier.mockResolvedValue(undefined);
      mockSkillModel.create.mockResolvedValue({
        id: 'skill-1',
        identifier: 'github.lobehub.skill-demo',
        name: 'GitHub Skill',
      });

      const result = await importer.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/skill-demo',
      });

      expect(mockGitHub.parseRepoUrl).toHaveBeenCalledWith(
        'https://github.com/lobehub/skill-demo',
        undefined,
      );
      expect(mockGitHub.downloadRepoZip).toHaveBeenCalledWith({
        branch: 'main',
        owner: 'lobehub',
        repo: 'skill-demo',
      });
      expect(mockSkillModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'github.lobehub.skill-demo',
          manifest: expect.objectContaining({
            gitUrl: 'https://github.com/lobehub/skill-demo',
            repository: 'https://github.com/lobehub/skill-demo',
          }),
          source: 'market',
        }),
      );
      expect(result.name).toBe('GitHub Skill');
    });

    it('should update existing skill when re-importing from same repo', async () => {
      mockGitHub.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'lobehub',
        repo: 'skill-demo',
      });
      mockGitHub.downloadRepoZip.mockResolvedValue(Buffer.from('mock-zip'));
      mockParser.parseZipPackage.mockResolvedValue({
        content: '# Updated content',
        manifest: { name: 'Updated Skill' },
        resources: new Map(),
        zipHash: 'ghi789',
      });
      mockResourceService.storeResources.mockResolvedValue({});
      mockSkillModel.findByIdentifier.mockResolvedValue({
        id: 'existing-skill-id',
        identifier: 'github.lobehub.skill-demo',
      });
      mockSkillModel.update.mockResolvedValue({
        id: 'existing-skill-id',
        name: 'Updated Skill',
      });

      const result = await importer.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/skill-demo',
      });

      expect(mockSkillModel.update).toHaveBeenCalledWith(
        'existing-skill-id',
        expect.objectContaining({
          content: '# Updated content',
          name: 'Updated Skill',
        }),
      );
      expect(mockSkillModel.create).not.toHaveBeenCalled();
      expect(result.name).toBe('Updated Skill');
    });

    it('should throw INVALID_URL error for invalid GitHub URL', async () => {
      const { GitHubParseError } = await import('@/server/modules/GitHub');
      mockGitHub.parseRepoUrl.mockImplementation(() => {
        throw new (GitHubParseError as any)('Invalid GitHub URL');
      });

      await expect(
        importer.importFromGitHub({ gitUrl: 'https://invalid-url.com/repo' }),
      ).rejects.toThrow(SkillImportError);

      try {
        await importer.importFromGitHub({ gitUrl: 'https://invalid-url.com/repo' });
      } catch (e) {
        expect((e as SkillImportError).code).toBe('INVALID_URL');
      }
    });

    it('should throw NOT_FOUND error when repository does not exist', async () => {
      const { GitHubNotFoundError } = await import('@/server/modules/GitHub');
      mockGitHub.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'lobehub',
        repo: 'non-existent',
      });
      mockGitHub.downloadRepoZip.mockImplementation(() => {
        throw new (GitHubNotFoundError as any)('Repository not found');
      });

      await expect(
        importer.importFromGitHub({ gitUrl: 'https://github.com/lobehub/non-existent' }),
      ).rejects.toThrow(SkillImportError);

      try {
        await importer.importFromGitHub({ gitUrl: 'https://github.com/lobehub/non-existent' });
      } catch (e) {
        expect((e as SkillImportError).code).toBe('NOT_FOUND');
      }
    });

    it('should use custom branch when provided', async () => {
      mockGitHub.parseRepoUrl.mockReturnValue({
        branch: 'develop',
        owner: 'lobehub',
        repo: 'skill-demo',
      });
      mockGitHub.downloadRepoZip.mockResolvedValue(Buffer.from('mock-zip'));
      mockParser.parseZipPackage.mockResolvedValue({
        content: '# Content',
        manifest: { name: 'Skill' },
        resources: new Map(),
        zipHash: 'xyz',
      });
      mockResourceService.storeResources.mockResolvedValue({});
      mockSkillModel.findByIdentifier.mockResolvedValue(undefined);
      mockSkillModel.create.mockResolvedValue({ id: 'skill-1', name: 'Skill' });

      await importer.importFromGitHub({
        branch: 'develop',
        gitUrl: 'https://github.com/lobehub/skill-demo',
      });

      expect(mockGitHub.parseRepoUrl).toHaveBeenCalledWith(
        'https://github.com/lobehub/skill-demo',
        'develop',
      );
    });
  });
});
