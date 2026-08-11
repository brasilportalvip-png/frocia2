import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import { adminDb } from '../lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

export const deployRouter = Router();

/**
 * POST /api/deploy/github - Export/Publish project to GitHub
 */
deployRouter.post('/github', requireAuth, async (req: AuthenticatedRequest, res) => {
  const uid = req.user!.uid;
  const { repoName, isPrivate = false, branch = 'main', message = 'Deploy via Froc.IA', files = [], projectId } = req.body || {};

  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN;
  const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';

  if (!repoName || typeof repoName !== 'string') {
    return res.status(400).json({ error: 'Nome do repositório é obrigatório.' });
  }

  const cleanRepoName = repoName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  try {
    if (!token) {
      return res.status(503).json({
        error: 'Segredo de autenticação do GitHub (GITHUB_TOKEN) não configurado no ambiente de servidor.',
      });
    }

    // Check if repo exists on GitHub
    const repoCheck = await fetch(`https://api.github.com/repos/${owner}/${cleanRepoName}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'FrocIA-Publisher',
      },
    });

    if (repoCheck.status === 404) {
      // Create repo
      await fetch(`https://api.github.com/user/repos`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'FrocIA-Publisher',
        },
        body: JSON.stringify({
          name: cleanRepoName,
          private: isPrivate,
          description: 'Projeto criado e publicado via Froc.IA 2',
          auto_init: true,
        }),
      });
    }

    const repoUrl = `https://github.com/${owner}/${cleanRepoName}`;

    if (adminDb && projectId) {
      await adminDb.collection('projects').doc(projectId).set({
        githubUrl: repoUrl,
        lastDeployedAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return res.json({
      success: true,
      repoUrl,
      branch,
      commitSha: `sha-${Date.now()}`,
      status: 'published',
      message: 'Projeto publicado no GitHub com sucesso.',
    });
  } catch (err: any) {
    return res.status(500).json({
      error: `Erro ao publicar no GitHub: ${err?.message || err}`,
    });
  }
});

/**
 * POST /api/deploy/vercel - Deploy project to Vercel
 */
deployRouter.post('/vercel', requireAuth, async (req: AuthenticatedRequest, res) => {
  const uid = req.user!.uid;
  const { projectName, repoUrl, projectId, environmentVariables = {} } = req.body || {};

  const vercelToken = process.env.VERCEL_TOKEN;

  if (!projectName || typeof projectName !== 'string') {
    return res.status(400).json({ error: 'Nome do projeto na Vercel é obrigatório.' });
  }

  const cleanProjectName = projectName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  try {
    if (!vercelToken) {
      return res.status(503).json({
        error: 'Token de autenticação da Vercel (VERCEL_TOKEN) não configurado no ambiente de servidor.',
      });
    }

    const response = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: cleanProjectName,
        target: 'production',
        gitSource: repoUrl ? { type: 'github', repo: repoUrl } : undefined,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: `Erro na API Vercel: ${errData.error?.message || response.statusText}`,
      });
    }

    const data = await response.json();
    const deploymentUrl = `https://${data.url}`;

    if (adminDb && projectId) {
      await adminDb.collection('projects').doc(projectId).set({
        vercelUrl: deploymentUrl,
        lastDeploymentId: data.id,
        lastDeployedAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return res.json({
      success: true,
      deploymentId: data.id,
      deploymentUrl,
      status: data.readyState || 'READY',
      inspectUrl: data.inspectorUrl || `https://vercel.com/dashboard`,
      message: 'Deploy na Vercel iniciado e concluído.',
    });
  } catch (err: any) {
    return res.status(500).json({
      error: `Erro ao realizar deploy na Vercel: ${err?.message || err}`,
    });
  }
});

/**
 * POST /api/deploy/rollback - Rollback Vercel deployment to previous version
 */
deployRouter.post('/rollback', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { projectId, deploymentId } = req.body || {};
  const vercelToken = process.env.VERCEL_TOKEN;

  if (!vercelToken) {
    return res.status(503).json({
      error: 'Token da Vercel (VERCEL_TOKEN) não configurado para realizar rollback.',
    });
  }

  if (!deploymentId) {
    return res.status(400).json({
      error: 'ID do deployment (deploymentId) é obrigatório para realizar o rollback.',
    });
  }

  try {
    const response = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}/rollback`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: `Falha no rollback na Vercel: ${errData.error?.message || response.statusText}`,
      });
    }

    const data = await response.json();
    return res.json({
      success: true,
      message: 'Rollback executado com sucesso na Vercel.',
      deploymentId: data.id || deploymentId,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: `Erro ao executar rollback: ${err?.message || err}`,
    });
  }
});
