import { skillManifestSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { SkillImporter, SkillResourceService } from '@/server/services/skill';

// ===== Procedure with Context =====

const skillProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      skillImporter: new SkillImporter(ctx.serverDB, ctx.userId),
      skillModel: new AgentSkillModel(ctx.serverDB, ctx.userId),
      skillResourceService: new SkillResourceService(ctx.serverDB, ctx.userId),
    },
  });
});

// ===== Input Schemas =====

const createSkillSchema = z.object({
  content: z.string(),
  description: z.string().optional(),
  identifier: z.string().optional(),
  name: z.string().min(1),
});

const updateSkillSchema = z.object({
  content: z.string().optional(),
  description: z.string().optional(),
  id: z.string(),
  manifest: skillManifestSchema.partial().optional(),
  name: z.string().optional(),
});

// ===== Router =====

export const skillRouter = router({
  // ===== Create =====

  create: skillProcedure.input(createSkillSchema).mutation(async ({ ctx, input }) => {
    return ctx.skillImporter.createUserSkill(input);
  }),

  // ===== Delete =====

  delete: skillProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    return ctx.skillModel.delete(input.id);
  }),

  // ===== Query =====

  getById: skillProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    return ctx.skillModel.findById(input.id);
  }),

  getByIdentifier: skillProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.skillModel.findByIdentifier(input.identifier);
    }),

  importFromGitHub: skillProcedure
    .input(
      z.object({
        branch: z.string().optional(),
        gitUrl: z.string().url(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.skillImporter.importFromGitHub(input);
    }),

  importFromZip: skillProcedure
    .input(z.object({ zipFileId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.skillImporter.importFromZip(input);
    }),

  list: skillProcedure
    .input(
      z
        .object({
          source: z.enum(['builtin', 'market', 'user']).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (input?.source) {
        return ctx.skillModel.listBySource(input.source);
      }
      return ctx.skillModel.findAll();
    }),

  listResources: skillProcedure
    .input(z.object({ skillId: z.string() }))
    .query(async ({ ctx, input }) => {
      const skill = await ctx.skillModel.findById(input.skillId);
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
      }

      if (!skill.resources) {
        return [];
      }

      return ctx.skillResourceService.listResources(skill.resources);
    }),

  readResource: skillProcedure
    .input(
      z.object({
        path: z.string(),
        skillId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const skill = await ctx.skillModel.findById(input.skillId);
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
      }

      if (!skill.resources || Object.keys(skill.resources).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Skill has no resources' });
      }

      return ctx.skillResourceService.readResource(skill.resources, input.path);
    }),

  search: skillProcedure.input(z.object({ query: z.string() })).query(async ({ ctx, input }) => {
    return ctx.skillModel.search(input.query);
  }),

  // ===== Update =====

  update: skillProcedure.input(updateSkillSchema).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    return ctx.skillModel.update(id, data);
  }),
});

export type SkillRouter = typeof skillRouter;
