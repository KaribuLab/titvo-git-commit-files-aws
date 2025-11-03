import { Module } from '@nestjs/common'
import configuration from './configuration';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino'
import * as pino from 'pino'
import { GitCommitFilesModule } from './git-commit-files/git-commit-files.module'
import { ParameterModule } from './parameter/parameter.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level (label: string): { level: string } {
            return { level: label }
          }
        }
      }
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ParameterModule.forRoot(),
    GitCommitFilesModule,
  ]
})
export class AppModule {}
