import { Injectable } from '@nestjs/common'
import { GitHubClientService } from '@lambda/git-commit-files/respositories-handler/github/github-client.service'
import { SshGitRepoClient } from '@lambda/git-commit-files/respositories-handler/ssh/ssh-git-repo-client.service'
import { RepoClient } from './repo.client'


enum RepoHostDomain {
  GitHub = 'github.com',
  Bitbucket = 'bitbucket.org',
}

@Injectable()
export class RepoFactoryService {
  constructor(
    private readonly github: GitHubClientService,
    private readonly sshGit: SshGitRepoClient
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
      // Usa el cliente SSH (clone) para evitar el rate limit 429 de la API
      // en full scan / descargas masivas.
      this.sshGit.initFromRepoUrl(repoUrl)
      return this.sshGit
    }

    throw new Error(`Unsupported repo provider: ${repoUrl}`)
  }
}