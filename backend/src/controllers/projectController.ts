import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createProject,
  deleteProject,
  getProjectById,
  listProjects,
  renameProject,
  resolveProject,
} from '../services/projectService.js';
import { AppError } from '../utils/errors.js';

export async function listProjectsHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const projects = await listProjects(userId);
  return reply.send({ projects });
}

export async function createProjectHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const body = request.body as { name?: string; websiteUrl: string };
  const project = await createProject(userId, body);
  return reply.status(201).send(project);
}

export async function getProjectHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { projectId } = request.params as { projectId: string };
  const project = await getProjectById(userId, projectId);
  return reply.send(project);
}

export async function updateProjectHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { projectId } = request.params as { projectId: string };
  const body = (request.body ?? {}) as { name?: string };
  const project = await renameProject(userId, projectId, body.name ?? '');
  return reply.send(project);
}

export async function deleteProjectHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const { projectId } = request.params as { projectId: string };
  await deleteProject(userId, projectId);
  return reply.status(200).send({ message: 'Project deleted', id: projectId });
}

export async function resolveProjectHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const userId = request.userId!;
  const query = request.query as { websiteUrl?: string };
  if (!query.websiteUrl) {
    throw new AppError(400, 'A websiteUrl query parameter is required', 'INVALID_URL');
  }
  const project = await resolveProject(userId, query.websiteUrl);
  return reply.send(project);
}