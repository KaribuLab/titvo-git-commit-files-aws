#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { AppStack, basePath } from '../lib/app-stack';

async function isAppStackCompleted(cloudFormationClient: CloudFormationClient): Promise<boolean> {
  const commandCloudFormation = new DescribeStacksCommand({
    StackName: 'AppStack',
  });
  try {
    const responseCloudFormation = await cloudFormationClient.send(commandCloudFormation);
    if (responseCloudFormation.Stacks === undefined || responseCloudFormation.Stacks.length === 0) {
      return false;
    }
    const completedStacks = responseCloudFormation.Stacks.filter((stack) => stack.StackStatus === 'CREATE_COMPLETE');
    console.log(`Completed stacks: ${completedStacks.length}`);
    console.log(`Total stacks: ${responseCloudFormation.Stacks.length}`);
    return completedStacks.length === responseCloudFormation.Stacks.length;
  } catch (error) {
    return false;
  }
}

async function getParameters(ssmClient: SSMClient, nextToken?: string): Promise<Record<string, string>> {
  const commandSSM = new GetParametersByPathCommand({
    Path: basePath,
    Recursive: true,
    NextToken: nextToken,
  });
  const responseSSM = await ssmClient.send(commandSSM);
  if (responseSSM.Parameters !== undefined && responseSSM.Parameters.length === 0) {
    throw new Error('No parameters found');
  }
  let params: Record<string, string> = {};
  if (responseSSM.Parameters !== undefined) {
    params = responseSSM.Parameters.reduce((acc, param) => {
      if (param.Name !== undefined && param.Value !== undefined) {
        acc[param.Name as keyof Record<string, string>] = param.Value;
      }
      return acc;
    }, {} as Record<string, string>);
  }
  if (responseSSM.NextToken !== undefined) {
    params = { ...params, ...await getParameters(ssmClient, responseSSM.NextToken) };
  }
  return params;
}

(async () => {
  if (!process.env.CDK_STACK_NAME) {
    throw new Error('CDK_STACK_NAME is not set');
  }
  const cloudFormationClient = new CloudFormationClient({
    region: 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL ?? 'http://localstack:4566',
  });
  console.log('Waiting for stack AppStack to be created...');
  while (!await isAppStackCompleted(cloudFormationClient)) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const ssmClient = new SSMClient({
    region: 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL ?? 'http://localstack:4566',
  });
  const params = await getParameters(ssmClient);
  const app = new cdk.App();
  new AppStack(app, process.env.CDK_STACK_NAME as string, {
    /* If you don't specify 'env', this stack will be environment-agnostic.
     * Account/Region-dependent features and context lookups will not work,
     * but a single synthesized template can be deployed anywhere. */

    /* Uncomment the next line to specialize this stack for the AWS Account
     * and Region that are implied by the current CLI configuration. */
    // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

    /* Uncomment the next line if you know exactly what Account and Region you
     * want to deploy the stack to. */
    env: { account: '000000000000', region: 'us-east-1' },

    // Usar el sintetizador heredado para LocalStack (no requiere bootstrap)
    synthesizer: new cdk.LegacyStackSynthesizer(),
    eventBusName: params[`${basePath}/eventbridge/eventbus_name`],
    parameterTableName: params[`${basePath}/dynamodb/parameter/dynamodb_table_name`],
    s3GitFilesBucketName: params[`${basePath}/s3/mcp/git-commit-files/input/bucket_name`] || 'tvo-mcp-git-commit-files-input-local',
    aesKeyPath: '/tvo/security-scan/localstack/aes_secret',

    /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
  });
})();