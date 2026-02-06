import { z } from 'zod';

// ===== Manifest Schema =====

export const skillAuthorSchema = z.object({
  name: z.string(),
  url: z.string().url().optional(),
});

export const skillManifestSchema = z
  .object({
    author: skillAuthorSchema.optional(),

    // Required: skill description
    description: z.string().min(1, 'Skill description is required'),

    // Skill's specific Git location (supports subdirectory)
    // e.g. https://github.com/lobehub/skills/tree/main/code-review
    gitUrl: z.string().url().optional(),

    license: z.string().optional(),

    // Required fields
    name: z.string().min(1, 'Skill name is required'),

    permissions: z.array(z.string()).optional(),

    // Project main repository URL
    // e.g. https://github.com/lobehub/skills
    repository: z.string().url().optional(),

    // Optional fields
    version: z.string().optional(),
  })
  .passthrough();

export type SkillManifest = z.infer<typeof skillManifestSchema>;
export type SkillAuthor = z.infer<typeof skillAuthorSchema>;

// ===== Skill Source =====

export type SkillSource = 'builtin' | 'market' | 'user';

// ===== Parsed Skill =====

export interface ParsedSkill {
  content: string;
  manifest: SkillManifest;
  raw: string;
}

export interface ParsedZipSkill {
  content: string;
  manifest: SkillManifest;
  resources: Map<string, Buffer>;
  zipHash?: string;
}

// ===== Resource Types =====

export interface SkillResourceTreeNode {
  children?: SkillResourceTreeNode[];
  name: string;
  path: string;
  type: 'file' | 'directory';
}

// ===== Skill Item (for UI) =====

export interface SkillItem {
  content?: string | null;
  createdAt: Date;
  description?: string | null;
  id: string;
  identifier: string;
  manifest: SkillManifest;
  name: string;
  resources?: Record<string, string> | null;
  source: SkillSource;
  updatedAt: Date;
}

// ===== Service Input Types =====

export interface CreateSkillInput {
  content: string;
  description?: string;
  identifier?: string;
  name: string;
}

export interface ImportZipInput {
  zipFileId: string;
}

export interface ImportGitHubInput {
  branch?: string;
  gitUrl: string;
}

export interface UpdateSkillInput {
  content?: string;
  description?: string;
  id: string;
  manifest?: Partial<SkillManifest>;
  name?: string;
}
