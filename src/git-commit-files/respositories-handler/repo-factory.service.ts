import { Injectable } from '@nestjs/common'
import { BitbucketClientService } from './bitbucket/bitbucket-client.service'
import { GitHubClientService } from './github/github-client.service'
import { RepoClient } from './repo.client'


enum RepoHostDomain {
  GitHub = 'github.com',
  Bitbucket = 'bitbucket.org',
}

@Injectable()
export class RepoFactoryService {
  constructor(
    private readonly github: GitHubClientService,
    private readonly bitbucket: BitbucketClientService
  ) {}

  /**
   * Retrieves the appropriate RepoClient based on the repository URL.
   * @param repoUrl The URL of the repository.
   * @returns The initialized RepoClient instance.
   * @throws Error if the repository provider is unsupported.
   */
  getClientForRepoUrl(repoUrl: string): RepoClient {
    if (repoUrl.includes(RepoHostDomain.GitHub)) {
      this.github.initFromRepoUrl(repoUrl)
      return this.github
    }

    if (repoUrl.includes(RepoHostDomain.Bitbucket)) {
      this.bitbucket.initFromRepoUrl(repoUrl)
      return this.bitbucket
    }

    throw new Error('Unsupported repo provider')
  }
}