import type { Request, Response } from 'express';
import { getApp } from '../server.js';

export default async function handler(
  req: Request,
  res: Response
) {
  const forwardedPath = req.query.__path;

  if (typeof forwardedPath === 'string') {
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(req.query)) {
      if (key === '__path') continue;

      if (Array.isArray(value)) {
        for (const item of value) {
          query.append(key, String(item));
        }
      } else if (value !== undefined) {
        query.append(key, String(value));
      }
    }

    const queryString = query.toString();
    req.url = `/api/${forwardedPath}${queryString ? `?${queryString}` : ''}`;
  }

  const app = await getApp();
  return app(req, res);
}