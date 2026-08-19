import { findCrawlRunById } from '../repositories/crawlRepo.js';
import { findProjectById } from '../repositories/projectRepo.js';
import { AppError } from '../utils/errors.js';
import { isValidUuid } from '../utils/uuid.js';

export async function requireProjectOwned(userId: string, projectId: string) {
  if (!isValidUuid(projectId)) {
    throw new AppError(400, 'Invalid project id', 'INVALID_PROJECT_ID');
  }

  const project = await findProjectById(projectId);
  if (!project || project.userId !== userId) {
    throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
  }

  return project;
}

export async function requireCrawlOwned(userId: string, crawlId: string) {
  if (!isValidUuid(crawlId)) {
    throw new AppError(400, 'Invalid crawl id', 'INVALID_CRAWL_ID');
  }

  const crawl = await findCrawlRunById(crawlId);
  if (!crawl) {
    throw new AppError(404, 'Crawl not found', 'CRAWL_NOT_FOUND');
  }

  const project = await findProjectById(crawl.projectId);
  if (!project || project.userId !== userId) {
    throw new AppError(404, 'Crawl not found', 'CRAWL_NOT_FOUND');
  }

  return { crawl, project };
}