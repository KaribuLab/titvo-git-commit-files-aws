import { Test, TestingModule } from '@nestjs/testing'
import { AppModule } from '@lambda/app.module'
import { ConfigKeys } from '@lambda/config/config.key'

process.env[ConfigKeys.S3_BUCKET_NAME] = 'test-bucket'

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    rest: { repos: { getCommit: jest.fn(), getContent: jest.fn() } },
  })),
}))

describe('AppModule', () => {
  let module: TestingModule

  afterEach(async () => {
    await module?.close()
  })

  it('compila el grafo de dependencias sin errores de DI', async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    expect(module).toBeDefined()
  })
})
