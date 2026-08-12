import type { Request, Response } from 'express';
import { getApp } from '../server.js';

export const maxDuration = 60;

export default async function handler(
  req: Request,
  res: Response
) {
  const app = await getApp();
  return app(req, res);
}