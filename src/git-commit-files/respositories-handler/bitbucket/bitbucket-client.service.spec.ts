import { Test, TestingModule } from '@nestjs/testing'
import { BitbucketClientService } from './bitbucket-client.service'
import axios from 'axios'
import { FileInfo } from '../repo.client'

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

describe('BitbucketClientService', () => {
  let service: BitbucketClientService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BitbucketClientService]
    }).compile()

    service = module.get<BitbucketClientService>(BitbucketClientService)

    // resetear mocks antes de cada test
    mockedAxios.get.mockReset()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('should initialize workspace and repoSlug from repo URL', () => {
    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    expect(service['workspace']).toBe('workspace')
    expect(service['repoSlug']).toBe('repo')
  })

  it('should fetch commit files from files array', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { files: [{ path: 'file1.ts' }, { path: 'file2.ts' }] }
    })

    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    const files: FileInfo[] = await service.getCommitFiles('abc123')

    expect(files).toEqual([
      { path: 'file1.ts', filename: 'file1.ts' },
      { path: 'file2.ts', filename: 'file2.ts' }
    ])
  })

  it('should fetch commit files from values array', async () => {
    // Primer request devuelve valores vacíos
    mockedAxios.get.mockResolvedValueOnce({ data: { values: [] } })
    // Segundo request devuelve archivos en values
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        values: [
          { type: 'commit_file', path: 'fileA.ts' },
          { type: 'commit_file', path: 'fileB.ts' }
        ]
      }
    })

    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    const files: FileInfo[] = await service.getCommitFiles('abc123')

    expect(files).toEqual([
      { path: 'fileA.ts', filename: 'fileA.ts' },
      { path: 'fileB.ts', filename: 'fileB.ts' }
    ])
  })

  it('should download a file as buffer', async () => {
    const fakeData = Buffer.from('hello bitbucket')
    mockedAxios.get.mockResolvedValueOnce({ data: fakeData })

    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    const buffer = await service.downloadFile('file1.ts', 'abc123')

    expect(buffer.toString()).toBe('hello bitbucket')
  })

  it('should throw if download fails', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'))

    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    await expect(
      service.downloadFile('file1.ts', 'abc123')
    ).rejects.toThrow('Network error')
  })
})
