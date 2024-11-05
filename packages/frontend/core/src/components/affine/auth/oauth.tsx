import { Skeleton } from '@affine/component';
import { Button } from '@affine/component/ui/button';
import { UrlService } from '@affine/core/modules/url';
import { OAuthProviderType } from '@affine/graphql';
import { GithubIcon, GoogleDuotoneIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { type ReactElement, useCallback } from 'react';

import { ServerConfigService } from '../../../modules/cloud';

const OAuthProviderMap: Record<
  OAuthProviderType,
  {
    icon: ReactElement;
  }
> = {
  [OAuthProviderType.Google]: {
    icon: <GoogleDuotoneIcon />,
  },

  [OAuthProviderType.GitHub]: {
    icon: <GithubIcon />,
  },

  [OAuthProviderType.OIDC]: {
    // TODO(@catsjuice): Add OIDC icon
    icon: <GoogleDuotoneIcon />,
  },
};

export function OAuth({ redirectUrl }: { redirectUrl?: string }) {
  const serverConfig = useService(ServerConfigService).serverConfig;
  const urlService = useService(UrlService);
  const oauth = useLiveData(serverConfig.features$.map(r => r?.oauth));
  const oauthProviders = useLiveData(
    serverConfig.config$.map(r => r?.oauthProviders)
  );
  const scheme = urlService.getClientScheme();

  if (!oauth) {
    return <Skeleton height={50} />;
  }

  return oauthProviders?.map(provider => (
    <OAuthProvider
      key={provider}
      provider={provider}
      redirectUrl={redirectUrl}
      scheme={scheme}
      popupWindow={url => {
        urlService.openPopupWindow(url);
      }}
    />
  ));
}

function OAuthProvider({
  provider,
  redirectUrl,
  scheme,
  popupWindow,
}: {
  provider: OAuthProviderType;
  redirectUrl?: string;
  scheme?: string;
  popupWindow: (url: string) => void;
}) {
  const { icon } = OAuthProviderMap[provider];

  const onClick = useCallback(() => {
    const params = new URLSearchParams();

    params.set('provider', provider);

    if (redirectUrl) {
      params.set('redirect_uri', redirectUrl);
    }

    if (scheme) {
      params.set('client', scheme);
    }

    // TODO: Android app scheme not implemented
    // if (BUILD_CONFIG.isAndroid) {}

    const oauthUrl =
      (BUILD_CONFIG.isElectron ? BUILD_CONFIG.serverUrlPrefix : location.origin) +
      `/oauth/login?${params.toString()}`;

    popupWindow(oauthUrl);
  }, [popupWindow, provider, redirectUrl, scheme]);

  return (
    <Button
      key={provider}
      variant="primary"
      block
      size="extraLarge"
      style={{ marginTop: 30, width: '100%' }}
      prefix={icon}
      onClick={onClick}
    >
      Continue with {provider}
    </Button>
  );
}
