import type { Request, Response } from 'express';
import { getApp } from '../server.js';

// Mantém as rotas diretas com a mesma janela da entrada principal da API.
export const maxDuration = 300;

export default async function handler(
  req: Request,
  res: Response
) {
  const app = await getApp();
  return app(req, res);
}
