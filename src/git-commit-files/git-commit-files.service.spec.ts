import { Test, TestingModule } from '@nestjs/testing'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { GitCommitFilesService } from './git-commit-files.service'
import { RepoFactoryService } from './respositories-handler/repo-factory.service'
import { S3Service } from '../aws/s3.service'
import { RepoClient, FileInfo } from './respositories-handler/repo.client'
import { S3ParallelETLService } from './buckets/s3-parallel-uploader.service'
import { AwsModule } from '@lambda/aws/aws.module' // Módulo a mockear
import configuration from '@lambda/configuration'
import { ParameterModule } from '@lambda/parameter/parameter.module' // Módulo a mockear
// Importamos los tokens necesarios para referenciar los providers
import {
  EventBridgeService,
  DynamoDBService,
  SecretManagerService
} from '@lambda/aws'
import { ParameterService } from '@lambda/parameter/parameter.service'
import { GitCommitFilesInputDto } from './git-commit-files.dto'

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

// --- MOCK DE S3Service ---
// NOTA CLAVE: Eliminamos el jest.mock('../aws/s3.service') para evitar
// que interfiera con el useFactory del AwsModule real.
// Ahora S3Service se mockea COMPLETAMENTE en MockAwsModule.
const mockUploadFile = jest.fn()

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

// --- MOCK MODULES PARA AWS Y PARAMETER ---

// Mock de servicios AWS adicionales (para tokens no S3)
const MockAwsService = {
  sendEvent: jest.fn(),
  getItem: jest.fn(),
  getSecret: jest.fn()
}

// 1. MOCK MODULE para AwsModule
const MockAwsModule = {
  module: class MockAwsModule {}, // Proporcionamos los tokens que AwsModule exporta, usando mocks simples
  providers: [
    { provide: EventBridgeService, useValue: MockAwsService },
    { provide: DynamoDBService, useValue: MockAwsService },
    { provide: SecretManagerService, useValue: MockAwsService }, // Incluimos S3Service aquí con el mock de la función 'uploadFile'
    { provide: S3Service, useValue: { uploadFile: mockUploadFile } }
  ], // Es CRUCIAL exportar los mismos tokens que el AwsModule real
  exports: [
    S3Service,
    EventBridgeService,
    DynamoDBService,
    SecretManagerService
  ]
}

// 2. MOCK MODULE para ParameterModule
// Asumimos que ParameterModule exporta ParameterService
const mockParameterService = {
  get: jest.fn().mockResolvedValue('mock-value')
}

const MockParameterModule = {
  module: class MockParameterModule {},
  providers: [
    {
      provide: ParameterService, // Reemplazamos el servicio real
      useValue: mockParameterService
    }
  ],
  exports: [ParameterService]
}

// --- FIN MOCK MODULES ---

describe('GitCommitFilesService', () => {
  let service: GitCommitFilesService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        // ConfigModule.forRoot debe ir PRIMERO para que los módulos dependientes
        // (como AwsModule, ParameterModule) puedan obtener la configuración.
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration]
        }), // Las importaciones dinámicas se ANULAN con overrideModule
        AwsModule.forRoot(),
        ParameterModule.forRoot()
      ],
      providers: [
        GitCommitFilesService,
        S3ParallelETLService,
        { provide: RepoFactoryService, useValue: repoFactoryMock } // Ya no es necesario mockear S3Service aquí porque se hace en MockAwsModule.
      ]
    })
      .overrideModule(AwsModule) // ANULAR AWS MODULE
      .useModule(MockAwsModule)
      .overrideModule(ParameterModule) // ANULAR PARAMETER MODULE
      .useModule(MockParameterModule)
      .compile()

    service = module.get<GitCommitFilesService>(GitCommitFilesService) // Reset de mocks

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

    const input: GitCommitFilesInputDto = {
      data: {
        commitId: 'abc123',
        branch: 'main',
        repository: 'https://bitbucket.org/workspace/repo.git',
        status: 'success'
      },
      jobId: '1'
    }

    const result = await service.process(input) // Verifica que el RepoClient se haya usado

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
    ) // Verifica que S3 haya recibido el archivo

    expect(mockUploadFile).toHaveBeenCalledWith(
      `${input.commitId}/file1.ts`,
      expect.any(Buffer)
    ) // Validación del resultado final

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
