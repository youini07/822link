const { build } = require('vite');
const path = require('path');

async function doBuild() {
  try {
    await build({
      configFile: path.resolve(__dirname, 'vite.config.ts'),
      build: {
        minify: false,
        sourcemap: false
      }
    });
    console.log('Build finished successfully!');
  } catch (err) {
    console.error('BUILD ERROR CAUGHT:');
    console.error(err);
    process.exit(1);
  }
}

doBuild();
