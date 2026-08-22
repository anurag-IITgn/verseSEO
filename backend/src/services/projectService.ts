import {
  countProjectsByOwner,
  deleteProjectById,
  findProjectById,
  findProjectByOwnerAndWebsite,
  insertProject,
  listProjectsByOwnerWithLatestScan,
  updateProjectName,
  type Project,
  type ProjectWithLatestScan,
} from '../repositories/projectRepo.js';
import { findUserById } from '../repositories/userRepo.js';
import { AppError } from '../utils/errors.js';
import { isValidUuid } from '../utils/uuid.js';
import { validateAndNormalizeUrl } from './urlService.js';

const FREE_PROJECT_LIMIT = 1;
const PRO_PROJECT_LIMIT = 3;

export interface CreateProjectInput {
  name?: string;
  websiteUrl: string;
}

export async function createProject(userId: string, input: CreateProjectInput): Promise<Project> {
  const { websiteUrl, domain } = validateAndNormalizeUrl(input.websiteUrl);
  const name = input.name?.trim() ? input.name.trim() : null;

  // Enforce project limits based on plan.
  const user = await findUserById(userId);
  const plan = user?.plan ?? 'free';
  const projectLimit = plan === 'pro' ? PRO_PROJECT_LIMIT : FREE_PROJECT_LIMIT;
  const projectCount = await countProjectsByOwner(userId);
  if (projectCount >= projectLimit) {
    throw new AppError(403, `Project limit reached. Your ${plan} plan allows ${projectLimit} project${projectLimit > 1 ? 's' : ''}.`, 'PROJECT_LIMIT_REACHED');
  }

  const existing = await findProjectByOwnerAndWebsite(userId, websiteUrl);
  if (existing) {
    throw new AppError(409, 'A project for this website already exists', 'PROJECT_EXISTS');
  }

  try {
    return await insertProject({ userId, name, websiteUrl, domain });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new AppError(409, 'A project for this website already exists', 'PROJECT_EXISTS');
    }
    throw error;
  }
}

export async function getProjectById(userId: string, id: string): Promise<Project> {
  if (!isValidUuid(id)) {
    throw new AppError(400, 'Invalid project id', 'INVALID_PROJECT_ID');
  }

  const project = await findProjectById(id);
  if (!project || project.userId !== userId) {
    throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
  }

  return project;
}

export async function renameProject(userId: string, id: string, name: string): Promise<Project> {
  if (!isValidUuid(id)) {
    throw new AppError(400, 'Invalid project id', 'INVALID_PROJECT_ID');
  }

  const trimmed = name?.trim();
  if (!trimmed) {
    throw new AppError(400, 'Project name cannot be empty', 'INVALID_PROJECT_NAME');
  }
  if (trimmed.length > 255) {
    throw new AppError(400, 'Project name is too long', 'INVALID_PROJECT_NAME');
  }

  const project = await findProjectById(id);
  if (!project || project.userId !== userId) {
    throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
  }

  return updateProjectName(id, trimmed);
}

export async function deleteProject(userId: string, id: string): Promise<void> {
  if (!isValidUuid(id)) {
    throw new AppError(400, 'Invalid project id', 'INVALID_PROJECT_ID');
  }

  const project = await findProjectById(id);
  if (!project || project.userId !== userId) {
    throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
  }

  await deleteProjectById(id);
}

export async function resolveProject(userId: string, websiteUrl: string): Promise<Project> {
  const { websiteUrl: normalized } = validateAndNormalizeUrl(websiteUrl);

  const project = await findProjectByOwnerAndWebsite(userId, normalized);
  if (!project) {
    throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
  }

  return project;
}

export async function listProjects(userId: string): Promise<ProjectWithLatestScan[]> {
  return listProjectsByOwnerWithLatestScan(userId);
}