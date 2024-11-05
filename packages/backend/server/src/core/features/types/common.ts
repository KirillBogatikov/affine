import { registerEnumType } from '@nestjs/graphql';

export enum FeatureType {
  // user feature
  Admin = 'administrator',
  EarlyAccess = 'early_access',
  AIEarlyAccess = 'ai_early_access',
  UnlimitedCopilot = 'unlimited_copilot',
  UnlimitedWorkspace = 'unlimited_workspace',
  PersonalWorkspace = 'personal_workspace',
  TeamWorkspace = 'team_workspace',
  // workspace feature
  Copilot = 'copilot',
}

registerEnumType(FeatureType, {
  name: 'FeatureType',
  description: 'The type of workspace feature',
});
