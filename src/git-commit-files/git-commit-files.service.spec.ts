import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { GitCommitFilesService } from './git-commit-files.service'
import { RepoFactoryService } from './respositories-handler/repo-factory.service'
import { S3Service } from '../aws/s3.service'
import { RepoClient, FileInfo } from './respositories-handler/repo.client'

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    rest: {
      repos: {
        getCommit: jest.fn(),
        getContent: jest.fn()
      }
    }
  }))
}))

// Mock de S3
const mockUploadFile = jest.fn()
jest.mock('./buckets/s3.service', () => ({
  S3Service: jest.fn().mockImplementation(() => ({
    uploadFile: mockUploadFile
  }))
}))

// Mock de RepoClient
const repoClientMock: RepoClient & {
  initFromRepoUrl: jest.Mock<void, [string]>
  getCommitFiles: jest.Mock<Promise<FileInfo[]>, [string, string]>
  downloadFile: jest.Mock<Promise<Buffer>, [string, string, string]>
} = {
  initFromRepoUrl: jest.fn(),
  getCommitFiles: jest
    .fn()
    .mockResolvedValue([{ path: 'file1.ts', filename: 'file1.ts' }]),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('dummy content'))
}

// Mock de RepoFactoryService para devolver nuestro repoClientMock
const repoFactoryMock = {
  getClientForRepoUrl: jest.fn().mockReturnValue(repoClientMock)
}

describe('GitCommitFilesService', () => {
  let service: GitCommitFilesService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitCommitFilesService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('dummy') }
        },
        { provide: RepoFactoryService, useValue: repoFactoryMock },
        { provide: S3Service, useValue: { uploadFile: mockUploadFile } }
      ]
    }).compile()

    service = module.get<GitCommitFilesService>(GitCommitFilesService)

    // Reset de mocks
    mockUploadFile.mockReset()
    repoClientMock.initFromRepoUrl.mockReset()
    repoClientMock.getCommitFiles.mockResolvedValue([
      { path: 'file1.ts', filename: 'file1.ts' }
    ])
    repoClientMock.downloadFile.mockResolvedValue(Buffer.from('dummy content'))
    repoFactoryMock.getClientForRepoUrl.mockClear()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('should process commit and upload files to S3', async () => {
    mockUploadFile.mockResolvedValue(undefined) // Simula S3

    const input = {
      commitId: 'abc123',
      branch: 'main',
      repository: 'https://bitbucket.org/workspace/repo.git',
      status: 'success'
    }

    const result = await service.process(input as any)

    // Verifica que el RepoClient se haya usado
    expect(repoFactoryMock.getClientForRepoUrl).toHaveBeenCalledWith(
      input.repository
    )
    expect(repoClientMock.getCommitFiles).toHaveBeenCalledWith(
      input.commitId,
      input.branch
    )
    expect(repoClientMock.downloadFile).toHaveBeenCalledWith(
      'file1.ts',
      input.commitId,
      input.branch
    )

    // Verifica que S3 haya recibido el archivo
    expect(mockUploadFile).toHaveBeenCalledWith(
      `${input.commitId}/file1.ts`,
      expect.any(Buffer)
    )

    // Validación del resultado final
    expect(result.success).toBe(true)
    expect(result.data.uploadedFiles).toEqual([`${input.commitId}/file1.ts`])
  })

  it('should skip processing if status is not success', async () => {
    const input = {
      commitId: 'abc123',
      branch: 'main',
      repository: 'https://bitbucket.org/workspace/repo.git',
      status: 'failed'
    }

    const result = await service.process(input as any)

    expect(result.success).toBe(false)
    expect(result.data.uploadedFiles).toEqual([])
  })
})
