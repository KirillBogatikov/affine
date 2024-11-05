import {Injectable, Logger} from '@nestjs/common';
import {Prisma, PrismaClient, User} from '@prisma/client';

import {
  Config,
  CryptoHelper,
  EmailAlreadyUsed,
  EventEmitter,
  type EventPayload, InternalServerError,
  OnEvent,
  WrongSignInCredentials,
  WrongSignInMethod,
} from '../../fundamentals';
import {PermissionService} from '../permission';
import {validators} from '../utils/validators';
import {UserGroup} from "./types";
import {FeatureKind, FeatureType} from "../features";

type CreateUserInput = Omit<Prisma.UserCreateInput, 'name'> & { name?: string };

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  defaultUserSelect = {
    id: true,
    name: true,
    email: true,
    emailVerifiedAt: true,
    avatarUrl: true,
    registered: true,
    createdAt: true,
  } satisfies Prisma.UserSelect;

  constructor(
    private readonly config: Config,
    private readonly crypto: CryptoHelper,
    private readonly prisma: PrismaClient,
    private readonly emitter: EventEmitter,
    private readonly permission: PermissionService
  ) {}

  get userCreatingData() {
    return {
      name: 'Unnamed',
    };
  }

  async createUser(data: CreateUserInput, features: FeatureType[]) {
    validators.assertValidEmail(data.email);

    if (data.password) {
      const config = await this.config.runtime.fetchAll({
        'auth/password.max': true,
        'auth/password.min': true,
      });
      validators.assertValidPassword(data.password, {
        max: config['auth/password.max'],
        min: config['auth/password.min'],
      });
    }

    return this.createUser_without_verification(data, features);
  }

  async createUser_without_verification(data: CreateUserInput, features: FeatureType[]) {
    let user = await this.findUserByEmail(data.email);

    if (user) {
      throw new EmailAlreadyUsed();
    }

    if (data.password) {
      data.password = await this.crypto.encryptPassword(data.password);
    }

    if (!data.name) {
      data.name = data.email.split('@')[0];
    }

    const createdUser = await this.prisma.user.create({
      select: this.defaultUserSelect,
      data: {
        ...this.userCreatingData,
        ...data,
      },
    });

    if (!createdUser) {
      throw new InternalServerError('user create returned null');
    }

    await this.addUserFeatures(createdUser.id, features);

    return createdUser;
  }

  async addUserFeatures(userId: string, features: FeatureType[]) {
    return this.prisma.$transaction(async tx => {
      for (const feature of features) {
        const latestFlag = await tx.userFeature.findFirst({
          where: {
            userId,
            feature: {
              feature,
              type: FeatureKind.Feature,
            },
            activated: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        if (latestFlag) {
          continue;
        }

        const featureId = await tx.feature
          .findFirst({
            where: {feature, type: FeatureKind.Feature},
            orderBy: {version: 'desc'},
            select: {id: true},
          })
          .then(r => r?.id);

        if (!featureId) {
          throw new Error(`Feature ${feature} not found`);
        }

        await tx.userFeature
          .create({
            data: {
              reason: 'sign up',
              activated: true,
              userId,
              featureId,
            },
          });
      }
    });
  }

  async findUserById(id: string) {
    return this.prisma.user
      .findUnique({
        where: { id },
        select: this.defaultUserSelect,
      })
      .catch(() => {
        return null;
      });
  }

  async findUserByEmail(
    email: string
  ): Promise<Pick<User, keyof typeof this.defaultUserSelect> | null> {
    validators.assertValidEmail(email);
    const rows = await this.prisma.$queryRaw<
      // see [this.defaultUserSelect]
      {
        id: string;
        name: string;
        email: string;
        email_verified: Date | null;
        avatar_url: string | null;
        registered: boolean;
        created_at: Date;
      }[]
    >`
      SELECT "id", "name", "email", "email_verified", "avatar_url", "registered", "created_at"
      FROM "users"
      WHERE lower("email") = lower(${email})
    `;

    const user = rows[0];

    if (!user) {
      return null;
    }

    return {
      ...user,
      emailVerifiedAt: user.email_verified,
      avatarUrl: user.avatar_url,
      createdAt: user.created_at,
    };
  }

  /**
   * supposed to be used only for `Credential SignIn`
   */
  async findUserWithHashedPasswordByEmail(email: string): Promise<User | null> {
    validators.assertValidEmail(email);

    // see https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries#typing-queryraw-results
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        email: string;
        password: string | null;
        email_verified: Date | null;
        avatar_url: string | null;
        registered: boolean;
        created_at: Date;
      }[]
    >`
      SELECT *
      FROM "users"
      WHERE lower("email") = lower(${email})
    `;

    const user = rows[0];
    if (!user) {
      return null;
    }

    return {
      ...user,
      emailVerifiedAt: user.email_verified,
      avatarUrl: user.avatar_url,
      createdAt: user.created_at,
    };
  }

  async signIn(email: string, password: string) {
    const user = await this.findUserWithHashedPasswordByEmail(email);

    if (!user) {
      throw new WrongSignInCredentials();
    }

    if (!user.password) {
      throw new WrongSignInMethod();
    }

    const passwordMatches = await this.crypto.verifyPassword(
      password,
      user.password
    );

    if (!passwordMatches) {
      throw new WrongSignInCredentials();
    }

    return user;
  }

  async fulfillUser(
    email: string,
    group: UserGroup,
    data: Omit<Partial<Prisma.UserCreateInput>, 'id'>
  ) {
    const features: FeatureType[] = [];

    // TODO: fix quotas
    switch (group) {
      case UserGroup.Admin:

        features.push(FeatureType.Admin, FeatureType.UnlimitedWorkspace);
        break;

      case UserGroup.TeamLead:
        features.push(FeatureType.TeamWorkspace);
        break;

      case UserGroup.User:
        features.push(FeatureType.PersonalWorkspace);
        break;

      default:
        this.logger.error('unknown user group: ', group)
    }

    const user = await this.findUserByEmail(email);
    if (!user) {
      return this.createUser({
        email,
        name: email.split('@')[0],
        ...data,
      }, features);
    }

    if (user.registered) {
      delete data.registered;
    }
    if (user.emailVerifiedAt) {
      delete data.emailVerifiedAt;
    }

    if (Object.keys(data).length) {
      const updatedUser = await this.prisma.user.update({
        where: { id: user.id },
        data,
      });

      await this.prisma.userFeature
        .updateMany({
          where: {
            userId: updatedUser.id,
            activated: true,
          },
          data: {
            activated: false,
          },
        })

      await this.addUserFeatures(updatedUser.id, features);
    }

    this.emitter.emit('user.updated', user);

    return user;
  }

  async updateUser(
    id: string,
    data: Omit<Partial<Prisma.UserCreateInput>, 'id'>,
    select: Prisma.UserSelect = this.defaultUserSelect
  ) {
    if (data.password) {
      const config = await this.config.runtime.fetchAll({
        'auth/password.max': true,
        'auth/password.min': true,
      });
      validators.assertValidPassword(data.password, {
        max: config['auth/password.max'],
        min: config['auth/password.min'],
      });

      data.password = await this.crypto.encryptPassword(data.password);
    }

    if (data.email) {
      validators.assertValidEmail(data.email);
      const emailTaken = await this.prisma.user.count({
        where: {
          email: data.email,
          id: {
            not: id,
          },
        },
      });

      if (emailTaken) {
        throw new EmailAlreadyUsed();
      }
    }

    const user = await this.prisma.user.update({ where: { id }, data, select });

    this.emitter.emit('user.updated', user);

    return user;
  }

  async deleteUser(id: string) {
    const ownedWorkspaces = await this.permission.getOwnedWorkspaces(id);
    const user = await this.prisma.user.delete({ where: { id } });
    this.emitter.emit('user.deleted', { ...user, ownedWorkspaces });
  }

  @OnEvent('user.updated')
  async onUserUpdated(user: EventPayload<'user.updated'>) {
    const { enabled, customerIo } = this.config.metrics;
    if (enabled && customerIo?.token) {
      const payload = {
        name: user.name,
        email: user.email,
        created_at: Number(user.createdAt) / 1000,
      };
      try {
        await fetch(`https://track.customer.io/api/v1/customers/${user.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Basic ${customerIo.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        this.logger.error('Failed to publish user update event:', e);
      }
    }
  }

  @OnEvent('user.deleted')
  async onUserDeleted(user: EventPayload<'user.deleted'>) {
    const { enabled, customerIo } = this.config.metrics;
    if (enabled && customerIo?.token) {
      try {
        if (user.emailVerifiedAt) {
          // suppress email if email is verified
          await fetch(
            `https://track.customer.io/api/v1/customers/${user.email}/suppress`,
            {
              method: 'POST',
              headers: {
                Authorization: `Basic ${customerIo.token}`,
              },
            }
          );
        }
        await fetch(`https://track.customer.io/api/v1/customers/${user.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Basic ${customerIo.token}` },
        });
      } catch (e) {
        this.logger.error('Failed to publish user delete event:', e);
      }
    }
  }
}
