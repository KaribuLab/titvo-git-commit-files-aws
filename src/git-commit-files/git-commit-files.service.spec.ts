import { ConfigService } from '@nestjs/config'
import { ConfigKeys } from '@lambda/config/config.key'
import { GitCommitFilesService } from './git-commit-files.service'
import { CloneableRepoClient, FileInfo } from './respositories-handler/repo.client'

describe('GitCommitFilesService', () => {
  let repoClient: jest.Mocked<CloneableRepoClient>
  let repoFactory: { getClientForRepoUrl: jest.Mock }
  let s3Service: { initETLBatch: jest.Mock }
  let eventBridgeService: { putEvents: jest.Mock }
  let service: GitCommitFilesService

  beforeEach(() => {
    repoClient = {
      prepare: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined),
      getCommitFiles: jest
        .fn()
        .mockResolvedValue([{ path: 'file1.ts', filename: 'file1.ts' }]),
      resolveRef: jest.fn().mockResolvedValue('branch-head-sha'),
      getAllFiles: jest
        .fn()
        .mockResolvedValue([{ path: 'src/full.ts', filename: 'src/full.ts' }]),
      downloadFile: jest.fn().mockResolvedValue(Buffer.from('content')),
    }
    repoFactory = {
      getClientForRepoUrl: jest.fn().mockReturnValue(repoClient),
    }
    s3Service = {
      initETLBatch: jest.fn().mockImplementation(
        async (
          input: { files: FileInfo[]; storagePrefix: string },
        ): Promise<string[]> =>
          input.files.map((file) => `${input.storagePrefix}/${file.path}`),
      ),
    }
    eventBridgeService = { putEvents: jest.fn().mockResolvedValue(undefined) }
    const configService = {
      get: jest.fn((key: string) =>
        key === ConfigKeys.TITVO_EVENT_BUS_NAME ? 'test-event-bus' : undefined,
      ),
    } as unknown as ConfigService

    service = new GitCommitFilesService(
      configService,
      repoFactory as any,
      s3Service as any,
      eventBridgeService as any,
    )
  })

  it.each([
    'https://github.com/owner/repo.git',
    'https://bitbucket.org/workspace/repo.git',
  ])('processes commit scans through the selected SSH client for %s', async (repository) => {
    const result = await service.process({
      jobId: 'job-1',
      data: { repository, commitId: 'abc123' },
    })

    expect(repoFactory.getClientForRepoUrl).toHaveBeenCalledWith(repository)
    expect(repoClient.prepare).toHaveBeenCalledWith('abc123', { depth: 2 })
    expect(repoClient.getCommitFiles).toHaveBeenCalledWith('abc123')
    expect(s3Service.initETLBatch).toHaveBeenCalledWith(
      {
        files: [{ path: 'file1.ts', filename: 'file1.ts' }],
        ref: 'abc123',
        storagePrefix: 'abc123',
      },
      repoClient,
    )
    expect(repoClient.cleanup).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      success: true,
      data: {
        filesPaths: ['abc123/file1.ts'],
        scanMode: 'commit',
        storagePrefix: 'abc123',
      },
    })
  })

  it('processes a full scan with the existing storage and result contract', async () => {
    const result = await service.process({
      jobId: 'job-1',
      data: {
        repository: 'https://github.com/owner/repo.git',
        commitId: 'abc123',
        scanMode: 'full',
        branch: 'feature/ssh-only',
      },
    })

    expect(repoClient.prepare).toHaveBeenCalledWith('feature/ssh-only', {
      depth: 1,
    })
    expect(repoClient.resolveRef).toHaveBeenCalledWith('feature/ssh-only')
    expect(repoClient.getAllFiles).toHaveBeenCalledWith('branch-head-sha')
    expect(s3Service.initETLBatch).toHaveBeenCalledWith(
      {
        files: [{ path: 'src/full.ts', filename: 'src/full.ts' }],
        ref: 'branch-head-sha',
        storagePrefix: 'full/job-1',
      },
      repoClient,
    )
    expect(result.data).toEqual({
      filesPaths: ['full/job-1/src/full.ts'],
      commitId: 'abc123',
      scanMode: 'full',
      scanRef: 'branch-head-sha',
      storagePrefix: 'full/job-1',
    })
  })

  it.each([
    'SSH private key not found',
    'git clone failed',
  ])('reports preparation failure and still cleans up: %s', async (message) => {
    repoClient.prepare.mockRejectedValueOnce(new Error(message))

    const result = await service.process({
      jobId: 'job-1',
      data: {
        repository: 'https://github.com/owner/repo.git',
        commitId: 'abc123',
      },
    })

    expect(result.success).toBe(false)
    expect(result.data.filesPaths).toEqual([])
    expect(s3Service.initETLBatch).not.toHaveBeenCalled()
    expect(repoClient.cleanup).toHaveBeenCalledTimes(1)
  })

  it('requires a branch or ref for full scans before creating a client', async () => {
    const result = await service.process({
      jobId: 'job-1',
      data: {
        repository: 'https://github.com/owner/repo.git',
        commitId: 'abc123',
        scanMode: 'full',
      },
    })

    expect(result.success).toBe(false)
    expect(repoFactory.getClientForRepoUrl).not.toHaveBeenCalled()
  })

  it('publishes the unchanged result event structure', async () => {
    await service.process({
      jobId: 'job-1',
      data: {
        repository: 'https://bitbucket.org/workspace/repo.git',
        commitId: 'abc123',
      },
    })

    expect(eventBridgeService.putEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        Source: 'mcp.tool.git.commit-files',
        DetailType: 'output',
        EventBusName: 'test-event-bus',
        Detail: JSON.stringify({
          job_id: 'job-1',
          success: true,
          message: 'commit scan files processed successfully.',
          data: {
            commit_id: 'abc123',
            files_paths: ['abc123/file1.ts'],
            scan_mode: 'commit',
            scan_ref: 'abc123',
            storage_prefix: 'abc123',
          },
        }),
      }),
    ])
  })
})
