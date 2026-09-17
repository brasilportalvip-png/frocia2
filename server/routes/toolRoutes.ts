import { Router } from 'express';
import { CalculatorExpressionError, CalculatorService } from '../ai/calculatorService.js';
import { ToolExecutionError, ToolExecutionService } from '../ai/toolExecutionService.js';
import { createToolExecutionStateStore } from '../ai/toolExecutionStore.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';

export const toolRouter = Router();

let runtime: ToolExecutionService | undefined;

function getRuntime(): ToolExecutionService {
  runtime ||= new ToolExecutionService({
    store: createToolExecutionStateStore(),
    handlers: {
      execute_calculator: async ({ args }) => ({
        output: { value: CalculatorService.evaluate(String(args.expression)) },
        costCredits: 0,
        deterministicVerified: true,
      }),
    },
  });
  return runtime;
}

toolRouter.post('/execute', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    if (body.toolName !== 'execute_calculator') {
      return res.status(400).json({ error: { code: 'unknown_tool', message: 'Ferramenta não permitida neste endpoint.' } });
    }

    const receipt = await getRuntime().execute({
      toolName: body.toolName,
      args: body.args && typeof body.args === 'object' ? body.args as Record<string, unknown> : {},
      actor: {
        userId: req.user!.uid,
        tenantId: req.user!.tenantId,
        grantedScopes: ['user'],
      },
      estimatedCostCredits: 0,
      correlationId: req.correlationId,
    });

    return res.status(200).json({ data: receipt });
  } catch (error) {
    if (error instanceof CalculatorExpressionError) {
      return res.status(400).json({ error: { code: 'invalid_expression', message: error.message } });
    }
    if (error instanceof ToolExecutionError) {
      const status = error.code === 'rate_limit_exceeded' ? 429 : 400;
      return res.status(status).json({ error: { code: error.code, message: error.message } });
    }
    console.error('tool_route_failed', { correlationId: req.correlationId, error: error instanceof Error ? error.message : String(error) });
    return res.status(500).json({ error: { code: 'tool_execution_failed', message: 'Não foi possível executar a ferramenta.' } });
  }
});
