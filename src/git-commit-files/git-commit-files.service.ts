import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  GitCommitFilesInputDto,
  GitCommitFilesOutputDto
} from './git-commit-files.dto'
import { RepoFactoryService } from './respositories-handler/repo-factory.service'
import { FileInfo } from './respositories-handler/repo.client'
import { S3ParallelETLService } from './buckets/s3-parallel-uploader.service'
import { inspect } from 'util'
import { EventBridgeService } from '@lambda/aws/eventbridge'

/**
 * Main service that handles the complete commit processing flow.
 * It detects the provider, fetches the modified files, and uploads them to S3.
 */
@Injectable()
export class GitCommitFilesService {
  private readonly logger = new Logger(GitCommitFilesService.name)
  private static readonly EVENT_SOURCE = 'mcp.tool.git.commit-files'
  private static readonly EVENT_DETAIL_TYPE = 'output'
  private static readonly EVENT_BUS_CONFIG_KEY = 'titvoEventBusName'

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
    let uploadedFiles: string[] = []

    const jobCorrelationId = `[Job: ${jobId}]`

    this.logger.log(
      `Starting commit processing for ${data.commitId} in repository ${data.repository}...`,
      jobCorrelationId
    )

    try {
      const repoClient = this.repoFactory.getClientForRepoUrl(data.repository)

      // Fetch files
      const files: FileInfo[] = await repoClient.getCommitFiles(data.commitId)
      this.logger.log(`Found ${files.length} modified files.`, jobCorrelationId)

      // Upload files to S3
      uploadedFiles = await this.s3Service.initETLBatch(
        { files, commitId: data.commitId },
        repoClient
      )

      success = true
      message = `Commit ${data.commitId} processed successfully.`
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
      uploadedFiles = [] // Ensure uploadedFiles is empty on failure
    } finally {
      // Always send the result event, regardless of success or failure
      await this.sendEventBridgeResult(
        jobId,
        success,
        message,
        data.commitId,
        uploadedFiles
      )
    }

    // Return the final result
    return {
      jobId: jobId,
      success,
      message,
      data: { uploadedFiles, commitId: data.commitId }
    }
  }

  /**
   * Sends the final result of the commit processing to EventBridge.
   * @param jobId Task ID.
   * @param success Success indicator.
   * @param message Result message.
   * @param commitId ID of the processed commit.
   * @param uploadedFiles List of uploaded files.
   */
  private async sendEventBridgeResult(
    jobId: string,
    success: boolean,
    message: string,
    commitId: string,
    uploadedFiles: string[]
  ): Promise<void> {
    const eventBusName = this.configService.get<string>(
      GitCommitFilesService.EVENT_BUS_CONFIG_KEY
    )

    if (!eventBusName) {
      this.logger.warn(
        `'${GitCommitFilesService.EVENT_BUS_CONFIG_KEY}' not found in configuration. EventBridge event skipped for job ${jobId}.`
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
              uploaded_files: uploadedFiles
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
