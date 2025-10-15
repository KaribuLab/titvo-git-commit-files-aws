export default () => ({
  awsStage: process.env.AWS_STAGE ?? 'prod',
  awsEndpoint: process.env.AWS_ENDPOINT,
  awsRegion: process.env.AWS_REGION,
  dummy: 'dummy',
});
