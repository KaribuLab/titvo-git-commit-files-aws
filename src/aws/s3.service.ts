import { Injectable, Logger } from '@nestjs/common'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

export interface S3ServiceOptions {
  awsStage: string
  awsEndpoint: string
  awsRegion: string
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name)

  constructor(private readonly s3Client: S3Client) {}

  async uploadFile(
    bucketName: string,
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string
  ) {
    const cmd = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream'
    })
    this.logger.debug(`Uploading ${key} to bucket ${bucketName}`)
    await this.s3Client.send(cmd)
    return { bucket: bucketName, key }
  }
}

export function createS3Service(options: S3ServiceOptions): S3Service {
  const s3Client =
    options.awsStage === 'local'
      ? new S3Client({
          region: options.awsRegion,
          endpoint: options.awsEndpoint
        })
      : new S3Client()
  return new S3Service(s3Client)
}
