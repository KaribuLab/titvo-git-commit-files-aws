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
import { ConfigKeys } from '@lambda/config/config.key'

// El S3ParallelETLService valida en onModuleInit que exista el bucket de S3.
process.env[ConfigKeys.S3_BUCKET_NAME] = 'test-bucket'

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
  getCommitFiles: jest.Mock<Promise<FileInfo[]>, [string]>
  getAllFiles: jest.Mock<Promise<FileInfo[]>, [string]>
  downloadFile: jest.Mock<Promise<Buffer>, [string, string]>
} = {
  initFromRepoUrl: jest.fn(),
  getCommitFiles: jest
    .fn()
    .mockResolvedValue([{ path: 'file1.ts', filename: 'file1.ts' }]),
  getAllFiles: jest
    .fn()
    .mockResolvedValue([{ path: 'src/full.ts', filename: 'src/full.ts' }]),
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
      // Garantizamos que el S3Service inyectado sea el mock en cualquier scope
      .overrideProvider(S3Service)
      .useValue({ uploadFile: mockUploadFile })
      .compile()

    // Ejecuta los hooks OnModuleInit (configura pLimit y bucket en S3ParallelETLService)
    await module.init()

    service = module.get<GitCommitFilesService>(GitCommitFilesService) // Reset de mocks

    mockUploadFile.mockReset()
    repoClientMock.initFromRepoUrl.mockReset()
    repoClientMock.getCommitFiles.mockClear()
    repoClientMock.getCommitFiles.mockResolvedValue([
      { path: 'file1.ts', filename: 'file1.ts' }
    ])
    repoClientMock.getAllFiles.mockClear()
    repoClientMock.getAllFiles.mockResolvedValue([
      { path: 'src/full.ts', filename: 'src/full.ts' }
    ])
    repoClientMock.downloadFile.mockClear()
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
        repository: 'https://bitbucket.org/workspace/repo.git'
      },
      jobId: '1'
    }

    const result = await service.process(input) // Verifica que el RepoClient se haya usado

    expect(repoFactoryMock.getClientForRepoUrl).toHaveBeenCalledWith(
      input.data.repository
    )
    expect(repoClientMock.getCommitFiles).toHaveBeenCalledWith(
      input.data.commitId
    )
    expect(repoClientMock.downloadFile).toHaveBeenCalledWith(
      'file1.ts',
      input.data.commitId
    )

    // S3 recibe (bucket, key, buffer)
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.any(String),
      `${input.data.commitId}/file1.ts`,
      expect.any(Buffer)
    )

    // Validación del resultado final
    expect(result.success).toBe(true)
    expect(result.data.filesPaths).toEqual([`${input.data.commitId}/file1.ts`])
    expect(result.data.scanMode).toBe('commit')
    expect(result.data.storagePrefix).toBe(input.data.commitId)
  })

  it('should process full scan and upload files with full storage prefix', async () => {
    mockUploadFile.mockResolvedValue(undefined)

    const input: GitCommitFilesInputDto = {
      data: {
        commitId: 'abc123',
        repository: 'https://bitbucket.org/workspace/repo.git',
        scanMode: 'full',
        branch: 'main'
      },
      jobId: '1'
    }

    const result = await service.process(input)

    expect(repoClientMock.getAllFiles).toHaveBeenCalledWith('main')
    expect(repoClientMock.getCommitFiles).not.toHaveBeenCalled()
    expect(repoClientMock.downloadFile).toHaveBeenCalledWith('src/full.ts', 'main')
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.any(String),
      'full/1/src/full.ts',
      expect.any(Buffer)
    )
    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      filesPaths: ['full/1/src/full.ts'],
      commitId: 'abc123',
      scanMode: 'full',
      scanRef: 'main',
      storagePrefix: 'full/1'
    })
  })

  it('should return success=false when file processing throws', async () => {
    repoClientMock.getCommitFiles.mockRejectedValueOnce(
      new Error('boom')
    )

    const input: GitCommitFilesInputDto = {
      data: {
        commitId: 'abc123',
        repository: 'https://bitbucket.org/workspace/repo.git'
      },
      jobId: '1'
    }

    const result = await service.process(input)

    expect(result.success).toBe(false)
    expect(result.data.filesPaths).toEqual([])
  })
})
