const minimist = require('minimist');

const { parseConfig, parseForwardConfig } = require('./utils/helpers');
const SSHClient = require('./modules/ssh_client');

async function start() {
  try {

    const args = minimist(process.argv.slice(2));
    const options = {};

    if (args.L) {
      options.forwardOut = parseForwardConfig(args.L);
    }

    if (args.R) {
      options.forwardIn = parseForwardConfig(args.R);
    }
    
    const connectionConfig = parseConfig(args._[0]);
    new SSHClient(connectionConfig, options);
  
  } catch (e) {
    console.log(e.message);
  }
}

start();