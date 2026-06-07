import { Test, TestingModule } from '@nestjs/testing'
import { BitbucketClientService } from './bitbucket-client.service'
import axios from 'axios'
import { FileInfo } from '../repo.client'
import { ParameterService } from '@lambda/parameter/parameter.service'

// --- MOCKS DE DEPENDENCIAS EXTERNAS ---
// 1. Mock de Axios para simular peticiones HTTP
jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

// 2. Mock del ParameterService para simular la obtención segura del token.
//    La implementación usa este valor directamente como token de autenticación Basic.
const MOCK_API_TOKEN = 'mock-basic-token'
const mockParameterService = {
  getDecryptedParameterValue: jest.fn().mockResolvedValue(MOCK_API_TOKEN)
}
// ---------------------------------------

describe('BitbucketClientService', () => {
  let service: BitbucketClientService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BitbucketClientService,
        {
          provide: ParameterService,
          useValue: mockParameterService
        }
      ]
    }).compile()

    service = module.get<BitbucketClientService>(BitbucketClientService)

    // resetear mocks antes de cada test
    mockedAxios.get.mockReset()
    mockParameterService.getDecryptedParameterValue.mockReset()
    mockParameterService.getDecryptedParameterValue.mockResolvedValue(
      MOCK_API_TOKEN
    )
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('should initialize workspace and repoSlug from repo URL', () => {
    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    // Usamos la notación de corchetes para acceder a propiedades privadas
    expect(service['workspace']).toBe('workspace')
    expect(service['repoSlug']).toBe('repo')
  })

  it('should fetch commit files from diffstat (Strategy 1)', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        values: [
          { status: 'modified', new: { path: 'file1.ts' }, old: { path: 'file1.ts' } },
          { status: 'added', new: { path: 'file2.ts' }, old: null }
        ]
      }
    })

    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    const files: FileInfo[] = await service.getCommitFiles('abc123')

    expect(files).toEqual([
      { path: 'file1.ts', filename: 'file1.ts' },
      { path: 'file2.ts', filename: 'file2.ts' }
    ])
    // Debe haber solo 1 llamada a axios.get, para la primera estrategia
    expect(mockedAxios.get).toHaveBeenCalledTimes(1)
    // La URL debe apuntar al endpoint diffstat
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/diffstat/abc123'),
      expect.any(Object)
    )
  })

  it('should skip removed files and follow pagination in diffstat', async () => {
    // Primera página: un modificado, un eliminado (se omite) y enlace 'next'
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        values: [
          { status: 'modified', new: { path: 'file1.ts' }, old: { path: 'file1.ts' } },
          { status: 'removed', new: null, old: { path: 'deleted.ts' } }
        ],
        next: 'https://api.bitbucket.org/2.0/next-page'
      }
    })
    // Segunda página: un renombrado (toma el path 'new')
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        values: [
          { status: 'renamed', new: { path: 'newName.ts' }, old: { path: 'oldName.ts' } }
        ]
      }
    })

    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    const files: FileInfo[] = await service.getCommitFiles('abc123')

    expect(files).toEqual([
      { path: 'file1.ts', filename: 'file1.ts' },
      { path: 'newName.ts', filename: 'newName.ts' }
    ])
    // Dos llamadas: una por página
    expect(mockedAxios.get).toHaveBeenCalledTimes(2)
  })

  it('should fallback to Strategy 2 (src endpoint)', async () => {
    // 1. Mock para Strategy 1 (falla: respuesta sin 'values')
    mockedAxios.get.mockResolvedValueOnce({
      data: { values: undefined }
    })
    // 2. Mock para Strategy 2 (éxito)
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
    // Debe haber 2 llamadas a axios.get: una para cada estrategia
    expect(mockedAxios.get).toHaveBeenCalledTimes(2)
  })

  it('should download a file as buffer using the Basic token', async () => {
    const fakeData = Buffer.from('hello bitbucket')
    mockedAxios.get.mockResolvedValueOnce({ data: fakeData })

    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    const buffer = await service.downloadFile('file1.ts', 'abc123')

    expect(buffer.toString()).toBe('hello bitbucket')

    // Verificar que la llamada a la API de descarga usó el token Basic
    const expectedAuthHeader = `Basic ${MOCK_API_TOKEN}`
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          Authorization: expectedAuthHeader
        },
        responseType: 'arraybuffer' // Verificar el tipo de respuesta
      })
    )
  })

  it('should fetch all files recursively and follow pagination', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        values: [
          { type: 'commit_file', path: 'README.md' },
          { type: 'commit_directory', path: 'src' }
        ],
        next: 'https://api.bitbucket.org/2.0/root-next'
      }
    })
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        values: [
          { type: 'commit_file', path: 'package.json' }
        ]
      }
    })
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        values: [
          { type: 'commit_file', path: 'src/app.ts' }
        ]
      }
    })

    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    const files = await service.getAllFiles('main')

    expect(files).toEqual([
      { path: 'README.md', filename: 'README.md' },
      { path: 'package.json', filename: 'package.json' },
      { path: 'src/app.ts', filename: 'src/app.ts' }
    ])
    expect(mockedAxios.get).toHaveBeenCalledTimes(3)
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/src/main/src'),
      expect.any(Object)
    )
  })

  it('should throw if credentials are not found in Parameter Store', async () => {
    // Simular que el token no existe en Parameter Store
    mockParameterService.getDecryptedParameterValue.mockResolvedValue(undefined)

    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    await expect(service.getCommitFiles('abc123')).rejects.toThrow(
      'Bitbucket client credentials not found in Parameter Store.'
    )

    // Sin token no se debe llamar a la API de Bitbucket
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })
})
