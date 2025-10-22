#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AppStack } from '../lib/app-stack';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

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

(async () => {
  const cloudFormationClient = new CloudFormationClient({
    region: 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL ?? 'http://localstack:4566',
  });
  console.log('Waiting for stack AppStack to be created...');
  while (!await isAppStackCompleted(cloudFormationClient)) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const app = new cdk.App();
  new AppStack(app, 'McpGitCommitFilesStack', {
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

    /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
  });
})();