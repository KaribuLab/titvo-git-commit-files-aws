import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  GitCommitFilesInputDto,
  GitCommitFilesOutputDto
} from './git-commit-files.dto'
import { RepoFactoryService } from './respositories-handler/repo-factory.service'
import { FileInfo, RepoClient } from './respositories-handler/repo.client'
import { S3ParallelETLService } from './buckets/s3-parallel-uploader.service'
import { inspect } from 'util'
import { EventBridgeService } from '@lambda/aws/eventbridge'
import { ConfigKeys } from '@lambda/config/config.key'

const DEFAULT_SCAN_MODE = 'commit'
const FULL_SCAN_MODE = 'full'

/**
 * Main service that handles the complete commit processing flow.
 * It detects the provider, fetches the modified files, and uploads them to S3.
 */
@Injectable()
export class GitCommitFilesService {
  private readonly logger = new Logger(GitCommitFilesService.name)
  private static readonly EVENT_SOURCE = 'mcp.tool.git.commit-files'
  private static readonly EVENT_DETAIL_TYPE = 'output'

  constructor(
    private readonly configService: ConfigService,
    private readonly repoFactory: RepoFactoryService,
    private readonly s3Service: S3ParallelETLService,
    private readonly eventBridgeService: EventBridgeService
  ) { }

  /**
   * Processes a commit received from a Lambda event.
   * @param input Commit data.
   */
  async process(
    input: GitCommitFilesInputDto
  ): Promise<GitCommitFilesOutputDto> {
    const { jobId, data } = input
    let success = false
    let message = ''
    let filesPaths: string[] = []
    const scanMode = data.scanMode ?? DEFAULT_SCAN_MODE
    const requestedRef = scanMode === FULL_SCAN_MODE ? data.scanRef ?? data.branch : data.commitId
    let scanRef = scanMode === FULL_SCAN_MODE ? requestedRef : data.commitId
    const storagePrefix = scanMode === FULL_SCAN_MODE ? `full/${jobId}` : data.commitId

    const jobCorrelationId = `[Job: ${jobId}]`

    this.logger.log(
      `Starting ${scanMode} processing for ${data.commitId} in repository ${data.repository}...`,
      jobCorrelationId
    )

    let repoClient: RepoClient | undefined

    try {
      if (scanMode === FULL_SCAN_MODE && !requestedRef) {
        throw new Error('branch or scanRef is required for full scan mode')
      }

      repoClient = this.repoFactory.getClientForRepoUrl(data.repository)

      // Fetch files
      let files: FileInfo[]
      if (scanMode === FULL_SCAN_MODE) {
        scanRef = await repoClient.resolveRef(requestedRef as string)
        if ('prepare' in repoClient) {
          await (repoClient as any).prepare(scanRef)
        }
        files = await repoClient.getAllFiles(scanRef)
      } else {
        if ('prepare' in repoClient) {
          await (repoClient as any).prepare(data.commitId)
        }
        files = await repoClient.getCommitFiles(data.commitId)
      }
      this.logger.log(`Found ${files.length} files.`, jobCorrelationId)

      // Upload files to S3
      filesPaths = await this.s3Service.initETLBatch(
        { files, ref: scanRef as string, storagePrefix },
        repoClient
      )

      success = true
      message = `${scanMode} scan files processed successfully.`
      this.logger.log('All files processed successfully.', jobCorrelationId)
    } catch (error) {
      // Better error handling/logging
      const err = error as Error
      const errorMessage = `Error processing commit ${data.commitId}. Message: ${err.message}`

      this.logger.error(
        `${errorMessage} | Details: ${inspect(error, {
          showHidden: false,
          depth: 5
        })}`,
        err.stack,
        jobCorrelationId
      )

      message = `Error processing commit: ${err.message}`
      filesPaths = [] // Ensure filesPaths is empty on failure
    } finally {
      // Liberar recursos locales (clone SSH, llave) si el cliente lo soporta.
      if (repoClient && 'cleanup' in repoClient) {
        try {
          await (repoClient as any).cleanup()
        } catch (cleanupErr) {
          this.logger.warn(
            `cleanup failed: ${(cleanupErr as Error).message}`,
            jobCorrelationId,
          )
        }
      }
      // Always send the result event, regardless of success or failure
      await this.sendEventBridgeResult(
        jobId,
        success,
        message,
        data.commitId,
        filesPaths,
        scanMode,
        scanRef,
        storagePrefix
      )
    }

    // Return the final result
    return {
      jobId: jobId,
      success,
      message,
      data: { filesPaths, commitId: data.commitId, scanMode, scanRef, storagePrefix }
    }
  }

  /**
   * Sends the final result of the commit processing to EventBridge.
   * @param jobId Task ID.
   * @param success Success indicator.
   * @param message Result message.
   * @param commitId ID of the processed commit.
   * @param filesPaths List of files paths.
   */
  private async sendEventBridgeResult(
    jobId: string,
    success: boolean,
    message: string,
    commitId: string,
    filesPaths: string[],
    scanMode: string,
    scanRef: string | undefined,
    storagePrefix: string
  ): Promise<void> {
    const eventBusName = this.configService.get<string>(
      ConfigKeys.TITVO_EVENT_BUS_NAME
    )

    if (!eventBusName) {
      this.logger.warn(
        `'${ConfigKeys.TITVO_EVENT_BUS_NAME}' not found in configuration. EventBridge event skipped for job ${jobId}.`
      )
      return
    }

    try {
      await this.eventBridgeService.putEvents([
        {
          Source: GitCommitFilesService.EVENT_SOURCE,
          DetailType: GitCommitFilesService.EVENT_DETAIL_TYPE,
          Detail: JSON.stringify({
            job_id: jobId,
            success: success,
            message: message,
            data: {
              commit_id: commitId,
              files_paths: filesPaths,
              scan_mode: scanMode,
              scan_ref: scanRef,
              storage_prefix: storagePrefix
            }
          }),
          EventBusName: eventBusName
        }
      ])

      this.logger.log(`EventBridge event successfully sent for job ${jobId}.`)
    } catch (error) {
      this.logger.error(
        `Error sending EventBridge event for job ${jobId}: ${(error as Error).message}`,
        (error as Error).stack,
        `[Job: ${jobId}]`
      )
    }
  }
}
