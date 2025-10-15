import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import * as path from 'path';

const basePath = '/tvo/security-scan/localstack/infra';

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Importar cola SQS existente de LocalStack
    const inputQueue = Queue.fromQueueArn(
      this,
      'InputQueue',
      `arn:aws:sqs:${props?.env?.region || 'us-east-1'}:${props?.env?.account || '000000000000'}:tvo-mcp-git-commit-files-input-local`
    );

    // Lambda Function
    const lambdaFunction = new Function(this, 'GitCommitFilesFunction', {
      functionName: 'mcp-git-commit-files-local',
      runtime: Runtime.NODEJS_22_X,
      handler: 'src/entrypoint.handler',
      code: Code.fromAsset(path.join(__dirname, '../../dist/lambda.zip')),
      timeout: cdk.Duration.seconds(300),
      memorySize: 512,
      description: 'Lambda function for MCP Git Commit Files',
      environment: {
        AWS_STAGE: 'local',
        LOG_LEVEL: 'debug',
      },
    });

    // Conectar Lambda con SQS
    lambdaFunction.addEventSource(new SqsEventSource(inputQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
      reportBatchItemFailures: true,
    }));

    // Parámetros SSM para la Lambda
    new StringParameter(this, 'SSMParameterLambdaArn', {
      parameterName: `${basePath}/lambda/git-commit-files/function_arn`,
      stringValue: lambdaFunction.functionArn,
      description: 'ARN de la función Lambda de MCP Git Commit Files'
    });

    new StringParameter(this, 'SSMParameterLambdaName', {
      parameterName: `${basePath}/lambda/git-commit-files/function_name`,
      stringValue: lambdaFunction.functionName,
      description: 'Nombre de la función Lambda de MCP Git Commit Files'
    });
  }
}
