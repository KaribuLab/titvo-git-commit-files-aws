import { DynamoDBService } from '@lambda/aws/dynamodb.service'
import { SecretManagerService } from '@lambda/aws/secretmanager.service'
import { createDecipheriv } from 'crypto'
import { Logger } from '@nestjs/common'

export interface ParameterServiceOptions {
  tableName: string
  aesKeyPath: string
  dynamoService: DynamoDBService
  secretManagerService: SecretManagerService
}

export class ParameterService {
  private readonly logger = new Logger(ParameterService.name)
  private aesKey: string
  constructor(
    private readonly dynamoService: DynamoDBService,
    private readonly secretManagerService: SecretManagerService,
    private readonly aesKeyPath: string,
    private readonly tableName: string
  ) {}
  async getParameterValue(parameterName: string): Promise<string | undefined> {
    this.logger.debug(
      `Getting parameter value for ${parameterName} on table ${this.tableName}`
    )
    const result = await this.dynamoService.getItem(this.tableName, {
      parameter_id: parameterName
    })
    return result?.value
  }

  async getDecryptedParameterValue(
    parameterName: string
  ): Promise<string | undefined> {
    const result = await this.getParameterValue(parameterName)
    console.log('Encrypted parameter value:', { parameterName, result })
    return result ? this.decrypt(result) : undefined
  }

  async decrypt(text: string): Promise<string> {
    if (!this.aesKey) {
      const aesKey = await this.secretManagerService.getSecretValue(
        this.aesKeyPath
      )
      if (!aesKey) {
        throw new Error('AES key is not set')
      }
      this.aesKey = aesKey
    }

    // Validar que la clave tenga 32 caracteres (AES-256)
    if (this.aesKey.length !== 32) {
      throw new Error('AES_KEY must have 32 characters length')
    }

    // Decodificar de base64
    const encrypted = Buffer.from(text, 'base64')

    // Desencriptar usando ECB (bloque por bloque)
    const blockSize = 16 // AES block size is always 16 bytes
    const decrypted = Buffer.alloc(encrypted.length)
    const keyBuffer = Buffer.from(this.aesKey, 'utf8')

    for (let i = 0; i < encrypted.length; i += blockSize) {
      const decipher = createDecipheriv('aes-256-ecb', keyBuffer as any, null)
      decipher.setAutoPadding(false) // Desactivar padding automático ya que lo hacemos manualmente

      const block = encrypted.subarray(i, i + blockSize)
      const decryptedBlock = Buffer.concat([
        decipher.update(block as any) as any,
        decipher.final() as any
      ])
      ;(decryptedBlock as any).copy(decrypted, i)
    }

    // Remover padding PKCS7
    const paddingLength = decrypted[decrypted.length - 1]
    const plaintext = decrypted.subarray(0, decrypted.length - paddingLength)

    // Retornar como string UTF-8
    return plaintext.toString('utf8')
  }
}

export function createParameterService(
  options: ParameterServiceOptions
): ParameterService {
  console.log('Creating ParameterService with options:', options)
  return new ParameterService(
    options.dynamoService,
    options.secretManagerService,
    options.aesKeyPath,
    options.tableName
  )
}
