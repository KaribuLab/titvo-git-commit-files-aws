import { Test, TestingModule } from '@nestjs/testing'
import { GitHubClientService } from './github-client.service'
import { ConfigService } from '@nestjs/config'
import { FileInfo } from './repo.client'

// ==========================================
// Mocks globales de Octokit
// ==========================================
const mockGetCommit = jest.fn()
const mockGetContent = jest.fn()

jest.mock('@octokit/rest', () => {
  return {
    Octokit: jest.fn().mockImplementation(() => ({
      rest: {
        repos: {
          getCommit: mockGetCommit,
          getContent: mockGetContent
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
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('fake-token') }
        }
      ]
    }).compile()

    service = module.get<GitHubClientService>(GitHubClientService)

    // Resetear mocks antes de cada test
    mockGetCommit.mockReset()
    mockGetContent.mockReset()
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

  it('should throw if getContent returns array (directory)', async () => {
    mockGetContent.mockResolvedValue({ data: [] })

    service.initFromRepoUrl('https://github.com/user/repo.git')

    await expect(service.downloadFile('dir', 'abc123')).rejects.toThrow(
      'Expected single file content'
    )
  })
})
