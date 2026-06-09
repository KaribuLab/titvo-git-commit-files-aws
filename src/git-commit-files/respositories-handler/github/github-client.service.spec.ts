import { Test, TestingModule } from '@nestjs/testing'
import { GitHubClientService } from './github-client.service'
import { ParameterService } from '@lambda/parameter/parameter.service'
import { FileInfo } from '../repo.client'

// ==========================================
// Mocks globales de Octokit
// ==========================================
const mockGetCommit = jest.fn()
const mockGetContent = jest.fn()
const mockGetTree = jest.fn()

jest.mock('@octokit/rest', () => {
  return {
    Octokit: jest.fn().mockImplementation(() => ({
      rest: {
        repos: {
          getCommit: mockGetCommit,
          getContent: mockGetContent
        },
        git: {
          getTree: mockGetTree
        }
      }
    }))
  }
})

describe('GitHubClientService', () => {
  let service: GitHubClientService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubClientService,
        {
          provide: ParameterService,
          useValue: {
            getDecryptedParameterValue: jest
              .fn()
              .mockResolvedValue('fake-token')
          }
        }
      ]
    }).compile()

    service = module.get<GitHubClientService>(GitHubClientService)

    // Resetear mocks antes de cada test
    mockGetCommit.mockReset()
    mockGetContent.mockReset()
    mockGetTree.mockReset()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('should initialize owner and repo from repo URL', () => {
    service.initFromRepoUrl('https://github.com/user/repo.git')
    expect(service['owner']).toBe('user')
    expect(service['repo']).toBe('repo')
  })

  it('should fetch commit files', async () => {
    mockGetCommit.mockResolvedValue({
      data: { files: [{ filename: 'file1.ts' }, { filename: 'file2.ts' }] }
    })

    service.initFromRepoUrl('https://github.com/user/repo.git')

    const files: FileInfo[] = await service.getCommitFiles('abc123')
    expect(files).toEqual([
      { path: 'file1.ts', filename: 'file1.ts' },
      { path: 'file2.ts', filename: 'file2.ts' }
    ])
  })

  it('should download a file and return buffer', async () => {
    const contentBase64 = Buffer.from('hello world').toString('base64')

    mockGetContent.mockResolvedValue({
      data: { content: contentBase64, encoding: 'base64' }
    })

    service.initFromRepoUrl('https://github.com/user/repo.git')

    const buffer = await service.downloadFile('file1.ts', 'abc123')
    expect(buffer.toString()).toBe('hello world')
  })

  it('should fetch all regular files from repository tree', async () => {
    mockGetCommit.mockResolvedValue({
      data: { commit: { tree: { sha: 'tree-sha' } } }
    })
    mockGetTree.mockResolvedValue({
      data: {
        tree: [
          { type: 'blob', path: 'src/app.ts' },
          { type: 'tree', path: 'src' },
          { type: 'blob', path: 'README.md' }
        ]
      }
    })

    service.initFromRepoUrl('https://github.com/user/repo.git')

    const files = await service.getAllFiles('main')

    expect(mockGetCommit).toHaveBeenCalledWith({
      owner: 'user',
      repo: 'repo',
      ref: 'main'
    })
    expect(mockGetTree).toHaveBeenCalledWith({
      owner: 'user',
      repo: 'repo',
      tree_sha: 'tree-sha',
      recursive: 'true'
    })
    expect(files).toEqual([
      { path: 'src/app.ts', filename: 'src/app.ts' },
      { path: 'README.md', filename: 'README.md' }
    ])
  })

  it('should resolve a ref to the commit sha', async () => {
    mockGetCommit.mockResolvedValue({
      data: { sha: 'branch-head-sha' }
    })

    service.initFromRepoUrl('https://github.com/user/repo.git')

    const ref = await service.resolveRef('feature/titvo-integration')

    expect(ref).toBe('branch-head-sha')
    expect(mockGetCommit).toHaveBeenCalledWith({
      owner: 'user',
      repo: 'repo',
      ref: 'feature/titvo-integration'
    })
  })

  it('should throw if getContent returns array (directory)', async () => {
    mockGetContent.mockResolvedValue({ data: [] })

    service.initFromRepoUrl('https://github.com/user/repo.git')

    await expect(service.downloadFile('dir', 'abc123')).rejects.toThrow(
      'Expected single file content'
    )
  })
})
