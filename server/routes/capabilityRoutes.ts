import { Router } from 'express';
import { CapabilityRegistryService } from '../services/capabilityRegistryService.js';

export const capabilityRouter = Router();

// GET /api/capabilities - Public capability registry endpoint
capabilityRouter.get('/capabilities', (req, res) => {
  const registry = CapabilityRegistryService.getCapabilityRegistry();
  return res.json(registry);
});
