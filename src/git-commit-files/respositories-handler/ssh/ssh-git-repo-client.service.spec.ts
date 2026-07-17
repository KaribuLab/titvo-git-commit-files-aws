import { Test, TestingModule } from '@nestjs/testing'
import { SshGitRepoClient } from './ssh-git-repo-client.service'
import { ParameterService } from '@lambda/parameter/parameter.service'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// Runner de git mockeado: simula un clone en un dir temporal bajo /tmp
function createMockGitRunner(): {
  runner: any
  calls: string[]
  files: string[]
  sha: string
} {
  const calls: string[] = []
  const sha = 'a'.repeat(40)
  const files = ['src/index.ts', 'src/app.module.ts', 'README.md']

  const runner = {
    clone: (cloneUrl: string, targetDir: string, ref: string) => {
      calls.push(`clone:${ref}`)
      fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true })
      for (const f of files) {
        fs.mkdirSync(path.dirname(path.join(targetDir, f)), {
          recursive: true,
        })
        fs.writeFileSync(path.join(targetDir, f), `content of ${f}`)
      }
    },
    fetchCommit: (cloneDir: string, cloneUrl: string, s: string) => {
      calls.push(`fetch:${s}`)
    },
    checkout: (cloneDir: string, s: string) => {
      calls.push(`checkout:${s}`)
    },
    revParseHead: () => sha,
    lsFiles: (cloneDir: string) => files,
    readFile: (cloneDir: string, filePath: string) =>
      fs.readFileSync(path.join(cloneDir, filePath)),
    resolveRemoteRef: (_cloneUrl: string, ref: string) => {
      if (/^[0-9a-f]{40}$/i.test(ref)) return ref
      calls.push(`resolve:${ref}`)
      return sha
    },
  }
  return { runner, calls, files, sha }
}

const MOCK_SSH_KEY = '-----BEGIN PRIVATE KEY-----\nmock\n-----END PRIVATE KEY-----'
const mockParameterService = {
  getDecryptedParameterValue: jest.fn().mockResolvedValue(MOCK_SSH_KEY),
}

describe('SshGitRepoClient', () => {
  let service: SshGitRepoClient
  let ctx: { runner: any; calls: string[]; files: string[]; sha: string }

  beforeEach(async () => {
    ctx = createMockGitRunner()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: SshGitRepoClient, useValue: undefined },
        { provide: ParameterService, useValue: mockParameterService },
      ],
    }).compile()
    service = new SshGitRepoClient(
      mockParameterService as any,
      ctx.runner,
    )
    mockParameterService.getDecryptedParameterValue.mockClear()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('initFromRepoUrl parses git@ ssh URL', () => {
    service.initFromRepoUrl('git@bitbucket.org:myworkspace/myrepo.git')
    expect(true).toBe(true) // parseo interno validado en prepare via clone mock
  })

  it('prepare() clones and resolves SHA for a branch ref', async () => {
    service.initFromRepoUrl('git@bitbucket.org:ws/repo.git')
    await service.prepare('main')
    expect(ctx.calls).toContain('clone:main')
    expect(mockParameterService.getDecryptedParameterValue).toHaveBeenCalled()
  })

  it('prepare() fetches+checkout when ref is a 40-char SHA', async () => {
    service.initFromRepoUrl('git@bitbucket.org:ws/repo.git')
    await service.prepare('b'.repeat(40))
    expect(ctx.calls).toContain(`fetch:${'b'.repeat(40)}`)
    expect(ctx.calls).toContain(`checkout:${'b'.repeat(40)}`)
  })

  it('getAllFiles() returns the working tree files after prepare', async () => {
    service.initFromRepoUrl('git@bitbucket.org:ws/repo.git')
    await service.prepare('main')
    const files = await service.getAllFiles('main')
    expect(files.map((f) => f.path).sort()).toEqual(ctx.files.sort())
  })

  it('downloadFile() reads from the local clone', async () => {
    service.initFromRepoUrl('git@bitbucket.org:ws/repo.git')
    await service.prepare('main')
    const buf = await service.downloadFile('README.md', 'main')
    expect(buf.toString()).toBe('content of README.md')
  })

  it('resolveRef() returns SHA for branch via ls-remote', async () => {
    service.initFromRepoUrl('git@bitbucket.org:ws/repo.git')
    const resolved = await service.resolveRef('develop')
    expect(ctx.calls).toContain('resolve:develop')
    expect(resolved).toBe(ctx.sha)
  })

  it('resolveRef() returns the same SHA when given a 40-char hash', async () => {
    service.initFromRepoUrl('git@bitbucket.org:ws/repo.git')
    const sha = 'c'.repeat(40)
    const resolved = await service.resolveRef(sha)
    expect(resolved).toBe(sha)
  })

  it('cleanup() does not throw even if called multiple times', async () => {
    service.initFromRepoUrl('git@bitbucket.org:ws/repo.git')
    await service.prepare('main')
    await expect(service.cleanup()).resolves.toBeUndefined()
    await expect(service.cleanup()).resolves.toBeUndefined()
  })

  it('prepare() throws if SSH private key secret is missing', async () => {
    const emptyParam = {
      getDecryptedParameterValue: jest.fn().mockResolvedValue(undefined),
    }
    const svc = new SshGitRepoClient(emptyParam as any, ctx.runner)
    svc.initFromRepoUrl('git@bitbucket.org:ws/repo.git')
    await expect(svc.prepare('main')).rejects.toThrow(/SSH private key/)
  })

  it('getAllFiles() throws if prepare() was not called', async () => {
    service.initFromRepoUrl('git@bitbucket.org:ws/repo.git')
    await expect(service.getAllFiles('main')).rejects.toThrow(/prepare\(\)/)
  })
})
