import { zip } from 'fflate';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SkillManifestError, SkillParseError } from './errors';
import { SkillParser } from './parser';

const createZip = (files: Record<string, Uint8Array>): Promise<Uint8Array> => {
  return new Promise((resolve, reject) => {
    zip(files, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
};

describe('SkillParser', () => {
  const parser = new SkillParser();

  describe('parseSkillMd', () => {
    it('should parse valid SKILL.md with frontmatter', () => {
      const content = `---
name: test-skill
description: A test skill
version: 1.0.0
---
# Test Skill

This is a test skill.`;

      const result = parser.parseSkillMd(content);

      expect(result.manifest.name).toBe('test-skill');
      expect(result.manifest.description).toBe('A test skill');
      expect(result.manifest.version).toBe('1.0.0');
      expect(result.content).toContain('# Test Skill');
      expect(result.raw).toBe(content);
    });

    it('should parse SKILL.md with optional author field', () => {
      const content = `---
name: test-skill
description: A test skill
author:
  name: John Doe
  url: https://example.com
---
Content`;

      const result = parser.parseSkillMd(content);

      expect(result.manifest.author).toEqual({
        name: 'John Doe',
        url: 'https://example.com',
      });
    });

    it('should parse SKILL.md with permissions', () => {
      const content = `---
name: test-skill
description: A test skill
permissions:
  - read_files
  - execute_code
---
Content`;

      const result = parser.parseSkillMd(content);

      expect(result.manifest.permissions).toEqual(['read_files', 'execute_code']);
    });

    it('should allow custom fields via passthrough', () => {
      const content = `---
name: test-skill
description: A test skill
customField: customValue
---
Content`;

      const result = parser.parseSkillMd(content);

      expect((result.manifest as any).customField).toBe('customValue');
    });

    it('should throw SkillManifestError for missing required name', () => {
      const content = `---
description: A test skill
---
Content`;

      expect(() => parser.parseSkillMd(content)).toThrow(SkillManifestError);
    });

    it('should throw SkillManifestError for missing required description', () => {
      const content = `---
name: test-skill
---
Content`;

      expect(() => parser.parseSkillMd(content)).toThrow(SkillManifestError);
    });

    it('should throw SkillManifestError for empty name', () => {
      const content = `---
name: ""
description: A test skill
---
Content`;

      expect(() => parser.parseSkillMd(content)).toThrow(SkillManifestError);
    });

    it('should trim content', () => {
      const content = `---
name: test
description: test
---

  Content with whitespace

`;

      const result = parser.parseSkillMd(content);

      expect(result.content).toBe('Content with whitespace');
    });
  });

  describe('validateManifest', () => {
    it('should validate valid manifest', () => {
      const data = {
        description: 'A test skill',
        name: 'test-skill',
        version: '1.0.0',
      };

      const result = parser.validateManifest(data);

      expect(result.name).toBe('test-skill');
      expect(result.description).toBe('A test skill');
    });

    it('should validate manifest with repository URL', () => {
      const data = {
        description: 'A test skill',
        name: 'test-skill',
        repository: 'https://github.com/lobehub/skills',
      };

      const result = parser.validateManifest(data);

      expect(result.repository).toBe('https://github.com/lobehub/skills');
    });

    it('should throw for invalid author URL', () => {
      const data = {
        author: {
          name: 'John',
          url: 'not-a-url',
        },
        description: 'A test skill',
        name: 'test-skill',
      };

      expect(() => parser.validateManifest(data)).toThrow(SkillManifestError);
    });
  });

  describe('parseZipPackage', () => {
    it('should parse ZIP with SKILL.md in root', async () => {
      const skillMd = `---
name: test-skill
description: A test skill
---
# Test Content`;

      const testFiles = {
        'SKILL.md': new TextEncoder().encode(skillMd),
        'resource.txt': new TextEncoder().encode('Resource content'),
      };

      const zipped = await createZip(testFiles);
      const result = await parser.parseZipPackage(Buffer.from(zipped));

      expect(result.manifest.name).toBe('test-skill');
      expect(result.content).toBe('# Test Content');
      expect(result.resources.has('resource.txt')).toBe(true);
      expect(result.resources.get('resource.txt')?.toString()).toBe('Resource content');
      expect(result.zipHash).toBeDefined();
      expect(result.zipHash).toHaveLength(64); // SHA-256 hex length
    });

    it('should parse ZIP with SKILL.md in subdirectory', async () => {
      const skillMd = `---
name: nested-skill
description: A nested skill
---
Nested content`;

      const testFiles = {
        'my-skill/SKILL.md': new TextEncoder().encode(skillMd),
        'my-skill/assets/image.png': new TextEncoder().encode('PNG data'),
        'my-skill/lib/helper.js': new TextEncoder().encode('helper code'),
      };

      const zipped = await createZip(testFiles);
      const result = await parser.parseZipPackage(Buffer.from(zipped));

      expect(result.manifest.name).toBe('nested-skill');
      expect(result.resources.has('assets/image.png')).toBe(true);
      expect(result.resources.has('lib/helper.js')).toBe(true);
      // SKILL.md should not be in resources
      expect(result.resources.has('SKILL.md')).toBe(false);
    });

    it('should skip __MACOSX files', async () => {
      const skillMd = `---
name: test
description: test
---
Content`;

      const testFiles = {
        'SKILL.md': new TextEncoder().encode(skillMd),
        '__MACOSX/._SKILL.md': new TextEncoder().encode('Mac metadata'),
        '__MACOSX/._resource.txt': new TextEncoder().encode('More metadata'),
        'resource.txt': new TextEncoder().encode('Real content'),
      };

      const zipped = await createZip(testFiles);
      const result = await parser.parseZipPackage(Buffer.from(zipped));

      expect(result.resources.has('resource.txt')).toBe(true);
      expect(result.resources.has('__MACOSX/._SKILL.md')).toBe(false);
      expect(result.resources.has('__MACOSX/._resource.txt')).toBe(false);
    });

    it('should skip hidden files', async () => {
      const skillMd = `---
name: test
description: test
---
Content`;

      const testFiles = {
        '.hidden': new TextEncoder().encode('Hidden file'),
        '.gitignore': new TextEncoder().encode('*.log'),
        'SKILL.md': new TextEncoder().encode(skillMd),
        'visible.txt': new TextEncoder().encode('Visible'),
      };

      const zipped = await createZip(testFiles);
      const result = await parser.parseZipPackage(Buffer.from(zipped));

      expect(result.resources.has('visible.txt')).toBe(true);
      expect(result.resources.has('.hidden')).toBe(false);
      expect(result.resources.has('.gitignore')).toBe(false);
    });

    it('should skip files outside skill directory when SKILL.md is in subdirectory', async () => {
      const skillMd = `---
name: test
description: test
---
Content`;

      const testFiles = {
        'README.md': new TextEncoder().encode('Root readme'),
        'my-skill/SKILL.md': new TextEncoder().encode(skillMd),
        'my-skill/resource.txt': new TextEncoder().encode('Skill resource'),
        'other-folder/file.txt': new TextEncoder().encode('Other file'),
      };

      const zipped = await createZip(testFiles);
      const result = await parser.parseZipPackage(Buffer.from(zipped));

      expect(result.resources.has('resource.txt')).toBe(true);
      expect(result.resources.has('README.md')).toBe(false);
      expect(result.resources.has('other-folder/file.txt')).toBe(false);
    });

    it('should throw SkillParseError when SKILL.md is not found', async () => {
      const testFiles = {
        'README.md': new TextEncoder().encode('No skill here'),
        'some-file.txt': new TextEncoder().encode('Just a file'),
      };

      const zipped = await createZip(testFiles);

      await expect(parser.parseZipPackage(Buffer.from(zipped))).rejects.toThrow(SkillParseError);
      await expect(parser.parseZipPackage(Buffer.from(zipped))).rejects.toThrow(
        'SKILL.md not found',
      );
    });

    it('should throw SkillParseError for invalid ZIP', async () => {
      const invalidBuffer = Buffer.from([1, 2, 3, 4]);

      await expect(parser.parseZipPackage(invalidBuffer)).rejects.toThrow(SkillParseError);
    });

    it('should throw SkillManifestError for invalid manifest in ZIP', async () => {
      const skillMd = `---
invalid: true
---
Content`;

      const testFiles = {
        'SKILL.md': new TextEncoder().encode(skillMd),
      };

      const zipped = await createZip(testFiles);

      await expect(parser.parseZipPackage(Buffer.from(zipped))).rejects.toThrow(SkillManifestError);
    });

    it('should calculate consistent zipHash', async () => {
      const skillMd = `---
name: test
description: test
---
Content`;

      const testFiles = {
        'SKILL.md': new TextEncoder().encode(skillMd),
      };

      const zipped = await createZip(testFiles);
      const buffer = Buffer.from(zipped);

      const result1 = await parser.parseZipPackage(buffer);
      const result2 = await parser.parseZipPackage(buffer);

      expect(result1.zipHash).toBe(result2.zipHash);
    });

    it('should handle empty resource set', async () => {
      const skillMd = `---
name: test
description: test
---
Only SKILL.md`;

      const testFiles = {
        'SKILL.md': new TextEncoder().encode(skillMd),
      };

      const zipped = await createZip(testFiles);
      const result = await parser.parseZipPackage(Buffer.from(zipped));

      expect(result.resources.size).toBe(0);
    });

    it('should prefer root SKILL.md over subdirectory SKILL.md', async () => {
      const rootSkillMd = `---
name: root-skill
description: Root skill
---
Root content`;

      const nestedSkillMd = `---
name: nested-skill
description: Nested skill
---
Nested content`;

      const testFiles = {
        'SKILL.md': new TextEncoder().encode(rootSkillMd),
        'nested/SKILL.md': new TextEncoder().encode(nestedSkillMd),
      };

      const zipped = await createZip(testFiles);
      const result = await parser.parseZipPackage(Buffer.from(zipped));

      expect(result.manifest.name).toBe('root-skill');
    });
  });

  describe('parseZipFile', () => {
    const testDir = join(tmpdir(), 'skill-parser-test');
    let testZipPath: string;

    beforeAll(async () => {
      await mkdir(testDir, { recursive: true });

      const skillMd = `---
name: file-test-skill
description: A skill from file
---
Content from file`;

      const testFiles = {
        'SKILL.md': new TextEncoder().encode(skillMd),
        'resource.txt': new TextEncoder().encode('Resource content'),
      };

      const zipped = await createZip(testFiles);
      testZipPath = join(testDir, 'test-skill.zip');
      await writeFile(testZipPath, zipped);
    });

    afterAll(async () => {
      await rm(testDir, { force: true, recursive: true });
    });

    it('should parse ZIP file from path', async () => {
      const result = await parser.parseZipFile(testZipPath);

      expect(result.manifest.name).toBe('file-test-skill');
      expect(result.manifest.description).toBe('A skill from file');
      expect(result.content).toBe('Content from file');
      expect(result.resources.has('resource.txt')).toBe(true);
      expect(result.zipHash).toBeDefined();
    });

    it('should throw SkillParseError for non-existent file', async () => {
      const nonExistentPath = join(testDir, 'non-existent.zip');

      await expect(parser.parseZipFile(nonExistentPath)).rejects.toThrow(SkillParseError);
      await expect(parser.parseZipFile(nonExistentPath)).rejects.toThrow('Failed to read ZIP file');
    });

    it('should throw SkillParseError for invalid ZIP file', async () => {
      const invalidZipPath = join(testDir, 'invalid.zip');
      await writeFile(invalidZipPath, Buffer.from([1, 2, 3, 4]));

      await expect(parser.parseZipFile(invalidZipPath)).rejects.toThrow(SkillParseError);
    });
  });
});
