const { SwcJsMinimizerRspackPlugin, IgnorePlugin } = require('@rspack/core')
const path = require('path')
const tsconfig = require('./tsconfig.json')

const aliases = Object.entries(tsconfig.compilerOptions.paths || {}).reduce(
  (acc, [alias, paths]) => {
    const formattedAlias = alias.replace('/*', '')
    const resolvedPath = path.resolve(__dirname, paths[0].replace('/*', ''))
    acc[formattedAlias] = resolvedPath
    return acc
  },
  {}
)

module.exports = {
  context: __dirname,
  target: 'node',
  entry: {
    entrypoint: ['./src/entrypoint.ts']
  },
  output: {
    path: path.resolve(__dirname, 'build/src'),
    filename: '[name].mjs',
    library: {
      type: 'module'
    },
    chunkFormat: 'module',
    clean: true
  },
  experiments: {
    outputModule: true,
    topLevelAwait: true
  },
  plugins: [
    new IgnorePlugin({
      resourceRegExp: /^@nestjs\/(websockets|microservices|platform-express)/
    })
  ],
  resolve: {
    extensions: ['...', '.ts'],
    alias: aliases
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: {
                syntax: 'typescript',
                decorators: true
              },
              transform: {
                legacyDecorator: true,
                decoratorMetadata: true
              }
            }
          }
        }
      }
    ]
  },
  optimization: {
    minimizer: [
      new SwcJsMinimizerRspackPlugin({
        minimizerOptions: {
          // We need to disable mangling and compression for class names and function names for Nest.js to work properly
          // The execution context class returns a reference to the class/handler function, which is for example used for applying metadata using decorators
          // https://docs.nestjs.com/fundamentals/execution-context#executioncontext-class
          compress: {
            keep_classnames: true,
            keep_fnames: true
          },
          mangle: {
            keep_classnames: true,
            keep_fnames: true
          }
        }
      })
    ]
  },
  externalsType: 'module',
  externals: [
    function (obj, callback) {
      const resource = obj.request
      const lazyImports = [
        '@nestjs/core',
        'class-validator',
        'class-transformer',
      ]
      if (!lazyImports.includes(resource)) {
        return callback()
      }
      try {
        require.resolve(resource)
      } catch (err) {
        callback(null, resource)
      }
      callback()
    }
  ]
}
