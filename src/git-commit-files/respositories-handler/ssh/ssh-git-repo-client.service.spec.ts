import * as fs from 'fs'
import * as path from 'path'
import { ParamsKeys } from '@lambda/config/config.key'
import {
  SshGitRepoClient,
  SshRepositoryConfig,
} from './ssh-git-repo-client.service'

interface MockRunnerOptions {
  files?: string[]
  changedFiles?: string[]
  hasParent?: boolean
}

function createMockGitRunner(
  filesOrOptions: string[] | MockRunnerOptions = ['src/index.ts', 'README.md'],
) {
  const options: MockRunnerOptions = Array.isArray(filesOrOptions)
    ? { files: filesOrOptions }
    : filesOrOptions
  const files = options.files ?? ['src/index.ts', 'README.md']
  const changedFiles = options.changedFiles ?? ['src/index.ts']
  const hasParent = options.hasParent ?? true
  const calls: string[] = []
  const cloneUrls: string[] = []
  const targetDirs: string[] = []
  const depths: number[] = []
  const sha = 'a'.repeat(40)
  const runner = {
    clone: (cloneUrl: string, targetDir: string, ref: string, depth: number) => {
      calls.push(`clone:${ref}`)
      cloneUrls.push(cloneUrl)
      targetDirs.push(targetDir)
      depths.push(depth)
      for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(targetDir, file)), { recursive: true })
        fs.writeFileSync(path.join(targetDir, file), `content of ${file}`)
      }
    },
    fetchCommit: (
      _cloneDir: string,
      _cloneUrl: string,
      commit: string,
      depth: number,
    ) => {
      calls.push(`fetch:${commit}`)
      depths.push(depth)
    },
    checkout: (_cloneDir: string, commit: string) =>
      calls.push(`checkout:${commit}`),
    revParseHead: () => sha,
    hasParent: (_cloneDir: string, commit: string) => {
      calls.push(`hasParent:${commit}`)
      return hasParent
    },
    diffTreeFiles: (_cloneDir: string, commit: string) => {
      calls.push(`diffTree:${commit}`)
      return changedFiles
    },
    lsTreeFiles: (_cloneDir: string, commit: string) => {
      calls.push(`lsTree:${commit}`)
      return files
    },
    lsFiles: () => {
      calls.push('lsFiles')
      return files
    },
    readFile: (cloneDir: string, filePath: string) =>
      fs.readFileSync(path.join(cloneDir, filePath)),
    resolveRemoteRef: (_cloneUrl: string, ref: string) => {
      calls.push(`resolve:${ref}`)
      return sha
    },
  }
  return { runner, calls, cloneUrls, targetDirs, depths, files, changedFiles, sha }
}

const BITBUCKET_CONFIG: SshRepositoryConfig = {
  cloneUrl: 'git@ssh.bitbucket.org:workspace/repo.git',
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

  it('defaults to a depth-1 clone when no options are given', async () => {
    await client.prepare('main')

    expect(context.depths).toEqual([1])
  })

  it('passes the requested depth to clone and fetch for a commit SHA', async () => {
    const commit = 'b'.repeat(40)
    await client.prepare(commit, { depth: 2 })

    expect(context.depths).toEqual([2, 2])
  })

  it('selects only the files changed by the commit, never the whole tree', async () => {
    const commit = 'b'.repeat(40)
    await client.prepare(commit, { depth: 2 })

    await expect(client.getCommitFiles(commit)).resolves.toEqual(
      context.changedFiles.map((file) => ({ path: file, filename: file })),
    )
    expect(context.calls).toContain(`hasParent:${context.sha}`)
    expect(context.calls).toContain(`diffTree:${context.sha}`)
    expect(context.calls).not.toContain('lsFiles')
    expect(context.calls).not.toContain(`lsTree:${context.sha}`)
  })

  it('falls back to the full tree for a root commit', async () => {
    const rootContext = createMockGitRunner({
      files: ['src/index.ts', 'README.md'],
      changedFiles: ['src/index.ts'],
      hasParent: false,
    })
    const rootClient = new SshGitRepoClient(
      parameterService as any,
      rootContext.runner,
    )
    rootClient.initialize(BITBUCKET_CONFIG)
    clients.push(rootClient)
    const commit = 'b'.repeat(40)
    await rootClient.prepare(commit, { depth: 2 })

    await expect(rootClient.getCommitFiles(commit)).resolves.toEqual(
      rootContext.files.map((file) => ({ path: file, filename: file })),
    )
    expect(rootContext.calls).toContain(`lsTree:${rootContext.sha}`)
    expect(rootContext.calls).not.toContain(`diffTree:${rootContext.sha}`)
    expect(rootContext.calls).not.toContain('lsFiles')
  })

  it('preserves paths with spaces reported by the diff', async () => {
    const spacedContext = createMockGitRunner({
      files: ['docs/my notes.md', 'README.md'],
      changedFiles: ['docs/my notes.md'],
    })
    const spacedClient = new SshGitRepoClient(
      parameterService as any,
      spacedContext.runner,
    )
    spacedClient.initialize(BITBUCKET_CONFIG)
    clients.push(spacedClient)
    await spacedClient.prepare('b'.repeat(40), { depth: 2 })

    await expect(spacedClient.getCommitFiles('b'.repeat(40))).resolves.toEqual([
      { path: 'docs/my notes.md', filename: 'docs/my notes.md' },
    ])
    await expect(
      spacedClient.downloadFile('docs/my notes.md', 'main'),
    ).resolves.toEqual(Buffer.from('content of docs/my notes.md'))
  })

  it('requires prepare() before getCommitFiles()', async () => {
    await expect(client.getCommitFiles('b'.repeat(40))).rejects.toThrow(
      /prepare\(\)/,
    )
  })

  it('keeps full scans on the tracked-file listing with depth 1', async () => {
    await client.prepare('main', { depth: 1 })

    await expect(client.getAllFiles('main')).resolves.toEqual(
      context.files.map((file) => ({ path: file, filename: file })),
    )
    expect(context.calls).toContain('lsFiles')
    expect(context.calls).not.toContain(`diffTree:${context.sha}`)
    expect(context.depths).toEqual([1])
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
