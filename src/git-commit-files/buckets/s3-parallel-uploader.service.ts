import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import pLimit from 'p-limit'
import { S3Service } from '../../aws/s3.service'
import { FileInfo, RepoClient } from '../respositories-handler/repo.client'
import { ConfigKeys, ParamsKeys } from '@lambda/config/config.key'
import { ParameterService } from '@lambda/parameter/parameter.service'

export interface FileUploadTask {
  s3Key: string
  fileBuffer: Buffer
  filePath: string
}

const DEFAULT_MAX_CONCURRENCY = 10

interface CommitData {
  files: FileInfo[]
  commitId: string
}

@Injectable()
export class S3ParallelETLService implements OnModuleInit {
  private readonly logger = new Logger(S3ParallelETLService.name)
  private limit: pLimit.Limit
  private bucketName: string

  constructor(
    private readonly s3Service: S3Service,
    private readonly configService: ConfigService
  ) { }

  async onModuleInit() {
    const bucket = this.configService.get<string>(ConfigKeys.S3_BUCKET_NAME)
    if (!bucket) {
      throw new Error(
        `Configuration key ${ConfigKeys.S3_BUCKET_NAME} is missing. Cannot initialize S3ParallelETLService.`
      )
    }
    this.bucketName = bucket
    const maxConcurrencyValueParam =
      (await this.configService.get(
        ParamsKeys.MAX_CONCURRENT_UPLOADS
      )) ?? DEFAULT_MAX_CONCURRENCY

    const maxConcurrency = Number(maxConcurrencyValueParam)
    this.limit = pLimit(maxConcurrency)

    this.logger.log(
      `Initialized with a concurrency limit of ${maxConcurrency} workers. Using bucket: ${this.bucketName}`
    )
    this.logger.log('S3ParallelETLService module initialized.')
  }

  /**
   * Uploads a batch of files to S3 concurrently with a limit.
   * Downloads each file from the repository and uploads it to S3.
   * @param commitData Object containing the list of files and the commit ID.
   * @param repoClient The client used to download files from the repository provider (e.g., GitHub, GitLab).
   * @returns Promise that resolves with the S3 keys of the successfully uploaded files.
   */
  async initETLBatch(
    commitData: CommitData,
    repoClient: RepoClient
  ): Promise<string[]> {
    this.logger.log(
      `Starting parallel upload for ${commitData.files.length} files...`
    )
    const uploadPromises = commitData.files.map((file) =>
      this.limit(async () => {
        try {
          this.logger.log(`Downloading file: ${file.path}`)

          const fileBuffer = await repoClient.downloadFile(
            file.path,
            commitData.commitId
          )

          const s3Key = `${commitData.commitId}/${file.path}`

          await this.s3Service.uploadFile(this.bucketName, s3Key, fileBuffer)

          this.logger.log(`File successfully uploaded: ${s3Key}`)
          return s3Key
        } catch (error) {
          this.logger.error(
            `Failed to process file ${file.path}. Error: ${(error as Error).message}`
          )
          return null
        }
      })
    )

    const results = await Promise.all(uploadPromises)

    const uploadedKeys = results.filter((key): key is string => key !== null)

    this.logger.log(
      `Batch upload finished. ${uploadedKeys.length} out of ${commitData.files.length} files uploaded successfully.`
    )

    if (uploadedKeys.length !== commitData.files.length) {
      this.logger.warn(
        `Attention: ${commitData.files.length - uploadedKeys.length} uploads failed.`
      )
    }

    return uploadedKeys
  }
}
