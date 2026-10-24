import { ProfessionalAdapters } from "./professionalAdapters.js";
import {
  ProfessionalBuildService,
  FirestoreBuildRepository,
} from "./professionalBuildService.js";
let service: ProfessionalBuildService | null = null;
export function getProfessionalFactory() {
  return (service ||= new ProfessionalBuildService(
    new FirestoreBuildRepository(),
    new ProfessionalAdapters(),
  ));
}
export function setProfessionalFactoryForTests(
  value: ProfessionalBuildService | null,
) {
  service = value;
}
