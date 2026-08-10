import { ParamsKeys } from '@lambda/config/config.key'
import { ParameterService } from '@lambda/parameter/parameter.service'
import {
  parseSshRepositoryConfig,
  RepoFactoryService,
} from './repo-factory.service'
import { SshGitRepoClient } from './ssh/ssh-git-repo-client.service'

describe('RepoFactoryService', () => {
  const parameterService = {
    getDecryptedParameterValue: jest.fn(),
  } as unknown as ParameterService
  const factory = new RepoFactoryService(parameterService)

  it.each([
    [
      'https://github.com/example/repository.git',
      'git@github.com:example/repository.git',
      ParamsKeys.GITHUB_SSH_PRIVATE_KEY,
    ],
    [
      'git@github.com:example/repository.git',
      'git@github.com:example/repository.git',
      ParamsKeys.GITHUB_SSH_PRIVATE_KEY,
    ],
    [
      'https://bitbucket.org/workspace/repository',
      'git@bitbucket.org:workspace/repository.git',
      ParamsKeys.BITBUCKET_SSH_PRIVATE_KEY,
    ],
    [
      'git@bitbucket.org:workspace/repository.git',
      'git@bitbucket.org:workspace/repository.git',
      ParamsKeys.BITBUCKET_SSH_PRIVATE_KEY,
    ],
  ])('normalizes %s', (repoUrl, cloneUrl, privateKeyParameter) => {
    expect(parseSshRepositoryConfig(repoUrl)).toEqual({
      cloneUrl,
      displayName: expect.any(String),
      privateKeyParameter,
    })
  })

  it.each([
    'https://github.com.evil.test/example/repository.git',
    'git@gitlab.com:example/repository.git',
    'https://github.com/example',
    'https://github.com/example/repository/extra',
    'file:///tmp/repository',
    'not-a-url',
  ])('rejects invalid or unsupported repository URL %s', (repoUrl) => {
    expect(() => parseSshRepositoryConfig(repoUrl)).toThrow()
  })

  it('returns a fresh SSH client for every job', () => {
    const first = factory.getClientForRepoUrl(
      'https://github.com/example/repository.git',
    )
    const second = factory.getClientForRepoUrl(
      'https://bitbucket.org/workspace/repository.git',
    )

    expect(first).toBeInstanceOf(SshGitRepoClient)
    expect(second).toBeInstanceOf(SshGitRepoClient)
    expect(first).not.toBe(second)
  })
})
