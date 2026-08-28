import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { AuthenticatedRequest } from '../types.js';
import { ExternalImportError } from '../services/externalImportService.js';
import { SiteAuditService } from '../services/siteAuditService.js';
import { SiteAuditPolicyService, SiteAuditRateLimitError } from '../ai/siteAuditPolicyService.js';

export const siteAuditRouter = Router();

const siteAuditLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 3,
  keyPrefix: 'site-audit'
});

const SiteAuditInputSchema = z.object({
  url: z.string().trim().url().max(2048),
  maxPages: z.number().int().min(1).max(40).default(20)
}).strict();

siteAuditRouter.post('/', requireAuth, siteAuditLimiter, async (req: AuthenticatedRequest, res) => {
  const parsed = SiteAuditInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: {
      code: 'invalid_site_audit_request',
      message: parsed.error.issues[0]?.message || 'Informe uma URL pública válida.',
      correlationId: req.correlationId
    } });
  }

  try {
    await SiteAuditPolicyService.assertAllowed({
      userId: req.user!.uid,
      tenantId: req.user!.tenantId
    });
    const report = await SiteAuditService.audit(parsed.data);
    const topIssues = [...report.siteWideIssues, ...report.pages.flatMap((page) => page.issues)]
      .sort((left, right) => {
        const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        return order[left.severity] - order[right.severity];
      })
      .slice(0, 30)
      .map((auditIssue) => `${auditIssue.severity.toUpperCase()} ${auditIssue.code}: ${auditIssue.url}`);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      report,
      imported: {
        type: 'site-audit',
        sourceUrl: report.requestedUrl,
        finalUrl: report.origin,
        title: `Auditoria de ${new URL(report.origin).hostname}`,
        summary: `${report.summary.pagesAnalyzed} página(s) analisada(s), ${report.summary.totalIssues} achado(s), estado ${report.status}.`,
        content: JSON.stringify(report, null, 2),
        mimeType: 'application/json',
        structure: topIssues,
        fetchedAt: report.completedAt
      }
    });
  } catch (error) {
    if (error instanceof SiteAuditRateLimitError) {
      return res.status(429).json({ error: {
        code: 'site_audit_rate_limited',
        message: error.message,
        resetAt: error.resetAt,
        correlationId: req.correlationId
      } });
    }
    if (error instanceof ExternalImportError) {
      return res.status(error.status).json({ error: {
        code: error.code,
        message: error.message,
        correlationId: req.correlationId
      } });
    }
    console.error('Falha inesperada na auditoria do site:', {
      correlationId: req.correlationId,
      userId: req.user?.uid,
      error
    });
    return res.status(500).json({ error: {
      code: 'site_audit_failed',
      message: 'Não foi possível concluir a auditoria do site.',
      correlationId: req.correlationId
    } });
  }
});
