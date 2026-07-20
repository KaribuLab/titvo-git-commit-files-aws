import { defineConfig } from 'turbowatch';

export default defineConfig({
  project: __dirname,
  triggers: [
    {
      expression: [
        'allof',
        ['not', ['match', 'node_modules', 'basename']],
        ['not', ['match', 'dist', 'basename']],
        ['not', ['match', 'build', 'basename']],
        ['not', ['match', 'cdk.out', 'basename']],
        ['anyof', ['match', '*.ts', 'basename'], ['match', 'src/**', 'wholename']],
      ],
      name: 'build-and-deploy',
      initialRun: true,
      interruptible: false,
      onChange: async ({ spawn }) => {
        try {
          await spawn`echo "Installing dependencies..."`;
          await spawn`npm install`;
          await spawn`cd cdklocal && npm install && npm run build`;
          
          await spawn`echo "Building lambda..."`;
          await spawn`rm -rf dist build`;
          await spawn`mkdir -p dist`;
          await spawn`rspack build`;
          
          await spawn`echo "Creating lambda zip..."`;
          await spawn`cd build && zip -r ../dist/lambda.zip .`;
          
          await spawn`echo "Deploying to LocalStack..."`;
          await spawn`cd cdklocal && cdklocal deploy --require-approval=never`;
          
          await spawn`echo "Deployment completed successfully!"`;
        } catch (error) {
          console.error('Error during build and deploy:', error);
        }
      },
    },
  ],
});