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
        ['anyof', ['match', '*.ts', 'basename'], ['match', 'src/**', 'wholename']],
      ],
      name: 'build-and-deploy',
      initialRun: true,
      interruptible: false,
      onChange: async ({ spawn }) => {
        try {
          await spawn`echo "Building image and deploying to MiniStack..."`;
          await spawn`sh scripts/deploy-ministack.sh`;

          await spawn`echo "Deployment completed successfully!"`;
        } catch (error) {
          console.error('Error during build and deploy:', error);
        }
      },
    },
  ],
});