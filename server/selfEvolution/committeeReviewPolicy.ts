import { COMMITTEE_ROLES, type CommitteeRole, type RiskLevel } from './selfEvolutionTypes.js';

/** Low-risk changes need technical verification; the other perspectives remain advisory. */
export function requiredCommitteeRoles(risk: RiskLevel): readonly CommitteeRole[] {
  return risk === 'R0' || risk === 'R1' ? ['security', 'qa', 'independent_verifier'] : COMMITTEE_ROLES;
}
