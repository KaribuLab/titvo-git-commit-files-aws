import { DynamicModule, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createS3Service, S3Service } from './s3.service'
import { createEventBridgeService, EventBridgeService } from './eventbridge'

@Module({})
export class AwsModule {
  static forRoot(): DynamicModule {
    return {
      module: AwsModule,
      providers: [
        {
          provide: S3Service,
          useFactory: (configService: ConfigService) =>
            createS3Service({
              awsStage: configService.get<string>('awsStage') ?? 'prod',
              awsEndpoint: configService.get<string>('awsEndpoint') as string,
              awsRegion: configService.get<string>('awsRegion') as string
            }),
          inject: [ConfigService]
        },
        {
          provide: EventBridgeService,
          useFactory: (configService: ConfigService) =>
            createEventBridgeService({
              awsStage: configService.get<string>('awsStage') ?? 'prod',
              awsEndpoint: configService.get<string>('awsEndpoint') as string,
              awsRegion: configService.get<string>('awsRegion') as string
            }),
          inject: [ConfigService]
        }
      ],
      exports: [S3Service, EventBridgeService]
    }
  }
}
