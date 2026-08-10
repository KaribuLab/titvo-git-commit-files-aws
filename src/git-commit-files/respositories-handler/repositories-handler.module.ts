import { Module } from '@nestjs/common'
import { RepoFactoryService } from './repo-factory.service'
import { ConfigModule } from '@nestjs/config'
import { ParameterModule } from '@lambda/parameter/parameter.module'

@Module({
  imports: [ConfigModule, ParameterModule.forRoot()],
  providers: [RepoFactoryService],
  exports: [RepoFactoryService],
})
export class RepositoriesHandlerModule {}
