import * as fs from 'fs'
import * as path from 'path'
import { ParamsKeys } from '@lambda/config/config.key'
import {
  SshGitRepoClient,
  SshRepositoryConfig,
} from './ssh-git-repo-client.service'

function createMockGitRunner(files = ['src/index.ts', 'README.md']) {
  const calls: string[] = []
  const cloneUrls: string[] = []
  const targetDirs: string[] = []
  const sha = 'a'.repeat(40)
  const runner = {
    clone: (cloneUrl: string, targetDir: string, ref: string) => {
      calls.push(`clone:${ref}`)
      cloneUrls.push(cloneUrl)
      targetDirs.push(targetDir)
      for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(targetDir, file)), { recursive: true })
        fs.writeFileSync(path.join(targetDir, file), `content of ${file}`)
      }
    },
    fetchCommit: (_cloneDir: string, _cloneUrl: string, commit: string) =>
      calls.push(`fetch:${commit}`),
    checkout: (_cloneDir: string, commit: string) =>
      calls.push(`checkout:${commit}`),
    revParseHead: () => sha,
    lsFiles: () => files,
    readFile: (cloneDir: string, filePath: string) =>
      fs.readFileSync(path.join(cloneDir, filePath)),
    resolveRemoteRef: (_cloneUrl: string, ref: string) => {
      calls.push(`resolve:${ref}`)
      return sha
    },
  }
  return { runner, calls, cloneUrls, targetDirs, files, sha }
}

const BITBUCKET_CONFIG: SshRepositoryConfig = {
  cloneUrl: 'git@bitbucket.org:workspace/repo.git',
  displayName: 'workspace/repo',
  privateKeyParameter: ParamsKeys.BITBUCKET_SSH_PRIVATE_KEY,
}

const GITHUB_CONFIG: SshRepositoryConfig = {
  cloneUrl: 'git@github.com:owner/repo.git',
  displayName: 'owner/repo',
  privateKeyParameter: ParamsKeys.GITHUB_SSH_PRIVATE_KEY,
}

const MOCK_SSH_KEY = '-----BEGIN PRIVATE KEY-----\nmock\n-----END PRIVATE KEY-----'

describe('SshGitRepoClient', () => {
  const clients: SshGitRepoClient[] = []
  let parameterService: { getDecryptedParameterValue: jest.Mock }
  let context: ReturnType<typeof createMockGitRunner>
  let client: SshGitRepoClient

  beforeEach(() => {
    context = createMockGitRunner()
    parameterService = {
      getDecryptedParameterValue: jest.fn().mockResolvedValue(MOCK_SSH_KEY),
    }
    client = new SshGitRepoClient(parameterService as any, context.runner)
    client.initialize(BITBUCKET_CONFIG)
    clients.push(client)
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((item) => item.cleanup()))
  })

  it('uses the configured key parameter and canonical clone URL', async () => {
    await client.prepare('main')

    expect(parameterService.getDecryptedParameterValue).toHaveBeenCalledWith(
      ParamsKeys.BITBUCKET_SSH_PRIVATE_KEY,
    )
    expect(context.cloneUrls).toEqual([BITBUCKET_CONFIG.cloneUrl])
  })

  it('fetches and checks out an exact commit SHA', async () => {
    const commit = 'b'.repeat(40)
    await client.prepare(commit)

    expect(context.calls).toContain(`fetch:${commit}`)
    expect(context.calls).toContain(`checkout:${commit}`)
  })

  it('preserves file listing, download, and ref resolution', async () => {
    await client.prepare('main')

    await expect(client.getAllFiles('main')).resolves.toEqual(
      context.files.map((file) => ({ path: file, filename: file })),
    )
    await expect(client.downloadFile('README.md', 'main')).resolves.toEqual(
      Buffer.from('content of README.md'),
    )
    await expect(client.resolveRef('develop')).resolves.toBe(context.sha)
  })

  it('returns exact SHA refs without remote resolution', async () => {
    const sha = 'c'.repeat(40)
    await expect(client.resolveRef(sha)).resolves.toBe(sha)
    expect(context.calls).not.toContain(`resolve:${sha}`)
  })

  it('fails before cloning when the configured key is missing', async () => {
    parameterService.getDecryptedParameterValue.mockResolvedValue(undefined)

    await expect(client.prepare('main')).rejects.toThrow(
      ParamsKeys.BITBUCKET_SSH_PRIVATE_KEY,
    )
    expect(context.cloneUrls).toHaveLength(0)
  })

  it('requires initialization and preparation in order', async () => {
    const uninitialized = new SshGitRepoClient(
      parameterService as any,
      context.runner,
    )
    clients.push(uninitialized)

    await expect(uninitialized.prepare('main')).rejects.toThrow(/initialized/)
    await expect(client.getAllFiles('main')).rejects.toThrow(/prepare\(\)/)
  })

  it('cleans up repeatedly without affecting another client', async () => {
    const githubContext = createMockGitRunner(['github.txt'])
    const githubClient = new SshGitRepoClient(
      parameterService as any,
      githubContext.runner,
    )
    githubClient.initialize(GITHUB_CONFIG)
    clients.push(githubClient)

    await Promise.all([client.prepare('main'), githubClient.prepare('main')])
    expect(context.targetDirs[0]).not.toBe(githubContext.targetDirs[0])

    await client.cleanup()
    await expect(
      githubClient.downloadFile('github.txt', 'main'),
    ).resolves.toEqual(Buffer.from('content of github.txt'))
    await expect(client.cleanup()).resolves.toBeUndefined()
  })

  it('isolates provider keys and clone state for concurrent jobs', async () => {
    const githubContext = createMockGitRunner(['github.txt'])
    const githubClient = new SshGitRepoClient(
      parameterService as any,
      githubContext.runner,
    )
    githubClient.initialize(GITHUB_CONFIG)
    clients.push(githubClient)

    await Promise.all([client.prepare('main'), githubClient.prepare('develop')])

    expect(parameterService.getDecryptedParameterValue).toHaveBeenCalledWith(
      ParamsKeys.BITBUCKET_SSH_PRIVATE_KEY,
    )
    expect(parameterService.getDecryptedParameterValue).toHaveBeenCalledWith(
      ParamsKeys.GITHUB_SSH_PRIVATE_KEY,
    )
    expect(context.cloneUrls).toEqual([BITBUCKET_CONFIG.cloneUrl])
    expect(githubContext.cloneUrls).toEqual([GITHUB_CONFIG.cloneUrl])
    expect(context.targetDirs[0]).not.toBe(githubContext.targetDirs[0])
  })
})
