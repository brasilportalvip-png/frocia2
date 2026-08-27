import { SiteQualityGateService } from './siteQualityGateService.js';
import { SiteSpecificationService } from './siteSpecificationService.js';

let specificationService: SiteSpecificationService | null = null;
let qualityGateService: SiteQualityGateService | null = null;

export function getSiteSpecificationService(): SiteSpecificationService {
  specificationService ||= SiteSpecificationService.createDefault();
  return specificationService;
}

export function getSiteQualityGateService(): SiteQualityGateService {
  qualityGateService ||= SiteQualityGateService.createDefault();
  return qualityGateService;
}

export function setSiteFactoryServicesForTests(input: {
  specificationService?: SiteSpecificationService | null;
  qualityGateService?: SiteQualityGateService | null;
}): void {
  if ('specificationService' in input) {
    specificationService = input.specificationService || null;
  }
  if ('qualityGateService' in input) {
    qualityGateService = input.qualityGateService || null;
  }
}
