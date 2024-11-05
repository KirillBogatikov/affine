import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import type { EventPayload } from '../../fundamentals';
import { OnEvent, PrismaTransaction } from '../../fundamentals';
import { FeatureManagementService } from '../features/management';
import { FeatureKind } from '../features/types';
import { QuotaConfig } from './quota';
import { QuotaType } from './types';

@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly feature: FeatureManagementService
  ) {}

  // get activated user quota
  async getUserQuota(userId: string) {
    const quota = await this.prisma.userFeature.findFirst({
      where: {
        userId,
        feature: {
          feature: {
            in: Object.values(QuotaType),
          },
        },
        activated: true,
      },
      select: {
        reason: true,
        createdAt: true,
        expiredAt: true,
        featureId: true,
      },
    });

    if (!quota) {
      // this should unreachable
      throw new Error(`User ${userId} has no quota`);
    }

    const feature = await QuotaConfig.get(this.prisma, quota.featureId);
    return { ...quota, feature };
  }

  // get user all quota records
  async getUserQuotas(userId: string) {
    const quotas = await this.prisma.userFeature.findMany({
      where: {
        userId,
        feature: {
          type: FeatureKind.Quota,
        },
      },
      select: {
        activated: true,
        reason: true,
        createdAt: true,
        expiredAt: true,
        featureId: true,
      },
      orderBy: {
        id: 'asc',
      },
    });
    const configs = await Promise.all(
      quotas.map(async quota => {
        try {
          return {
            ...quota,
            feature: await QuotaConfig.get(this.prisma, quota.featureId),
          };
        } catch {}
        return null as unknown as typeof quota & {
          feature: QuotaConfig;
        };
      })
    );

    return configs.filter(quota => !!quota);
  }

  // switch user to a new quota
  // currently each user can only have one quota
  async switchUserQuota(
    userId: string,
    quota: QuotaType,
    reason?: string,
    expiredAt?: Date
  ) {
    await this.prisma.$transaction(async tx => {
      const hasSameActivatedQuota = await this.hasQuota(userId, quota, tx);

      if (hasSameActivatedQuota) {
        // don't need to switch
        return;
      }

      const featureId = await tx.feature
        .findFirst({
          where: { feature: quota, type: FeatureKind.Quota },
          select: { id: true },
          orderBy: { version: 'desc' },
        })
        .then(f => f?.id);

      if (!featureId) {
        throw new Error(`Quota ${quota} not found`);
      }

      // we will deactivate all exists quota for this user
      await tx.userFeature.updateMany({
        where: {
          id: undefined,
          userId,
          feature: {
            type: FeatureKind.Quota,
          },
        },
        data: {
          activated: false,
        },
      });

      await tx.userFeature.create({
        data: {
          userId,
          featureId,
          reason: reason ?? 'switch quota',
          activated: true,
          expiredAt,
        },
      });
    });
  }

  async hasQuota(userId: string, quota: QuotaType, tx?: PrismaTransaction) {
    const executor = tx ?? this.prisma;

    return executor.userFeature
      .count({
        where: {
          userId,
          feature: {
            feature: quota,
            type: FeatureKind.Quota,
          },
          activated: true,
        },
      })
      .then(count => count > 0);
  }

  @OnEvent('user.subscription.activated')
  async onSubscriptionUpdated({
    userId,
    plan,
    recurring,
  }: EventPayload<'user.subscription.activated'>) {
    switch (plan) {
      case 'ai':
        await this.feature.addCopilot(userId, 'subscription activated');
        break;
      case 'pro':
        // TODO: fix quotas
        this.logger.debug('user.subscription.activated: ', userId, plan, recurring);
        break;
      default:
        break;
    }
  }

  @OnEvent('user.subscription.canceled')
  async onSubscriptionCanceled({
    userId,
    plan,
  }: EventPayload<'user.subscription.canceled'>) {
    switch (plan) {
      case 'ai':
        await this.feature.removeCopilot(userId);
        break;
      case 'pro': {
        // edge case: when user switch from recurring Pro plan to `Lifetime` plan,
        // a subscription canceled event will be triggered because `Lifetime` plan is not subscription based
        // TODO: fix quotas
        break;
      }
      default:
        break;
    }
  }
}
