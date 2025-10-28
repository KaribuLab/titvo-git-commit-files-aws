import { Test, TestingModule } from '@nestjs/testing'
import { BitbucketClientService } from './bitbucket-client.service'
import axios from 'axios'
import { FileInfo } from '../repo.client'
import { ParameterService } from '@lambda/parameter/parameter.service'

// --- MOCKS DE DEPENDENCIAS EXTERNAS ---
// 1. Mock de Axios para simular peticiones HTTP (incluyendo la de token y las de API)
jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

// 2. Mock del ParameterService para simular la obtención segura de credenciales
const mockBitbucketCredentials = {
  key: 'mock-client-id',
  secret: 'mock-client-secret'
}
const mockParameterService = {
  getDecryptedParameterValue: jest
    .fn()
    .mockResolvedValue(JSON.stringify(mockBitbucketCredentials))
}
// ---------------------------------------

// Datos esperados del token
const MOCK_ACCESS_TOKEN = 'mocked-oauth-token'
const MOCK_TOKEN_RESPONSE = {
  access_token: MOCK_ACCESS_TOKEN,
  expires_in: 3600 // 1 hora
}

describe('BitbucketClientService (OAuth 2.0)', () => {
  let service: BitbucketClientService

  // Función para simular una respuesta exitosa de Bitbucket API para el token
  const setupSuccessfulTokenMock = () => {
    // Usamos `mock.mockImplementation` para simular `fetch`
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(MOCK_TOKEN_RESPONSE)
    } as any)
  }

  beforeEach(async () => {
    // Aseguramos que el mock del token esté siempre listo antes de cualquier test
    setupSuccessfulTokenMock()

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
    mockParameterService.getDecryptedParameterValue.mockClear()
    ;(global.fetch as jest.Mock).mockClear()
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

  it('should obtain and use the access token when fetching commit files', async () => {
    // Simular respuesta de éxito de la API después de obtener el token
    mockedAxios.get.mockResolvedValueOnce({
      data: { files: [{ path: 'file1.ts' }] }
    })

    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    await service.getCommitFiles('abc123')

    // 1. Verificar que se intentó obtener el token (con el mock de fetch)
    expect(global.fetch).toHaveBeenCalledTimes(1)

    // 2. Verificar que la llamada a la API de Bitbucket (con axios) usó el Bearer Token
    const expectedAuthHeader = `Bearer ${MOCK_ACCESS_TOKEN}`
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          Authorization: expectedAuthHeader
        }
      })
    )
  })

  it('should fetch commit files from files array (Strategy 1)', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { files: [{ path: 'file1.ts' }, { path: 'file2.ts' }] }
    })

    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    const files: FileInfo[] = await service.getCommitFiles('abc123')

    expect(files).toEqual([
      { path: 'file1.ts', filename: 'file1.ts' },
      { path: 'file2.ts', filename: 'file2.ts' }
    ])
    // Debe haber solo 1 llamada a axios.get, para la primera estrategia
    expect(mockedAxios.get).toHaveBeenCalledTimes(1)
  })

  it('should fallback to Strategy 2 (src endpoint)', async () => {
    // 1. Mock para Strategy 1 (falla: no hay archivos)
    mockedAxios.get.mockResolvedValueOnce({
      data: { files: undefined }
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

  it('should download a file as buffer using the access token', async () => {
    const fakeData = Buffer.from('hello bitbucket')
    mockedAxios.get.mockResolvedValueOnce({ data: fakeData })

    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    const buffer = await service.downloadFile('file1.ts', 'abc123')

    expect(buffer.toString()).toBe('hello bitbucket')

    // Verificar que la llamada a la API de descarga usó el Bearer Token
    const expectedAuthHeader = `Bearer ${MOCK_ACCESS_TOKEN}`
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

  it('should throw if token fetching fails', async () => {
    // Simular un fallo en la obtención del token (fetch)
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Invalid credentials')
    } as any)

    service.initFromRepoUrl('https://bitbucket.org/workspace/repo.git')
    await expect(service.getCommitFiles('abc123')).rejects.toThrow(
      'Failed to obtain Bitbucket access token. Status: 401'
    )

    // Asegurarse de que no se llama a axios si el token falló
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })
})
