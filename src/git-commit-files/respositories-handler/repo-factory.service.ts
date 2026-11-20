import { Injectable } from '@nestjs/common'
import {
  SshGitRepoClient,
  SshRepositoryConfig,
} from '@lambda/git-commit-files/respositories-handler/ssh/ssh-git-repo-client.service'
import { ParameterService } from '@lambda/parameter/parameter.service'
import { ParamsKeys } from '@lambda/config/config.key'
import { RepoClient } from './repo.client'

const REPOSITORY_PART_PATTERN = /^[A-Za-z0-9._-]+$/

export const REPO_HOST_CONFIG = {
  'github.com': {
    sshHost: 'github.com',
    sshUser: 'git',
    privateKeyParameter: ParamsKeys.GITHUB_SSH_PRIVATE_KEY,
  },
  'bitbucket.org': {
    sshHost: 'ssh.bitbucket.org',
    sshUser: 'git',
    privateKeyParameter: ParamsKeys.BITBUCKET_SSH_PRIVATE_KEY,
  },
  'ssh.bitbucket.org': {
    sshHost: 'ssh.bitbucket.org',
    sshUser: 'git',
    privateKeyParameter: ParamsKeys.BITBUCKET_SSH_PRIVATE_KEY,
  },
} as const

type SupportedRepoHost = keyof typeof REPO_HOST_CONFIG

/** Validate repository coordinates and map web/legacy hosts to the SSH endpoint. */
export function parseSshRepositoryConfig(repoUrl: string): SshRepositoryConfig {
  const cleaned = repoUrl.trim().replace(/^git\+/, '').replace(/\.git$/, '')
  let host: string
  let repositoryPath: string

  const scpMatch = cleaned.match(/^git@([^/:]+):(.+)$/)
  if (scpMatch) {
    host = scpMatch[1].toLowerCase()
    repositoryPath = scpMatch[2]
  } else {
    let parsed: URL
    try {
      parsed = new URL(cleaned)
    } catch {
      throw new Error(`Invalid repository URL: ${repoUrl}`)
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Unsupported repository URL protocol: ${parsed.protocol}`)
    }
    host = parsed.hostname.toLowerCase()
    repositoryPath = parsed.pathname.replace(/^\//, '')
  }

  const hostConfig = REPO_HOST_CONFIG[host as SupportedRepoHost]
  if (!hostConfig) {
    throw new Error(`Unsupported repo provider: ${host}`)
  }

  const parts = repositoryPath.split('/').filter(Boolean)
  if (
    parts.length !== 2 ||
    !parts.every((part) => REPOSITORY_PART_PATTERN.test(part))
  ) {
    throw new Error(`Invalid repository path: ${repositoryPath}`)
  }

  const [namespace, repository] = parts
  return {
    cloneUrl: `${hostConfig.sshUser}@${hostConfig.sshHost}:${namespace}/${repository}.git`,
    displayName: `${namespace}/${repository}`,
    privateKeyParameter: hostConfig.privateKeyParameter,
  }
}

@Injectable()
export class RepoFactoryService {
  constructor(private readonly parameterService: ParameterService) {}

  /**
   * Retrieves the appropriate RepoClient based on the repository URL.
   * @param repoUrl The URL of the repository.
   * @returns The initialized RepoClient instance.
   * @throws Error if the repository provider is unsupported.
   */
  getClientForRepoUrl(repoUrl: string): RepoClient {
    const client = new SshGitRepoClient(this.parameterService)
    client.initialize(parseSshRepositoryConfig(repoUrl))
    return client
  }
}
