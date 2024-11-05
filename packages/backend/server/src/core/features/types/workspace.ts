import { z } from 'zod';

import { FeatureType } from './common';

export const featureUnlimitedWorkspace = z.object({
  feature: z.literal(FeatureType.UnlimitedWorkspace),
  configs: z.object({}),
});

export const featurePersonalWorkspace = z.object({
  feature: z.literal(FeatureType.PersonalWorkspace),
  configs: z.object({}),
});

export const featureTeamWorkspace = z.object({
  feature: z.literal(FeatureType.TeamWorkspace),
  configs: z.object({}),
});
