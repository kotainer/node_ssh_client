const minimist = require('minimist');

const { parseConfig } = require('./utils/helpers');
const SSHClient = require('./modules/ssh_client');

async function start() {
  try {

    const args = minimist(process.argv.slice(2));
    const connectionConfig = parseConfig(args._[0]);
    new SSHClient(connectionConfig);
  
  } catch (e) {
    console.log(e.message);
  }
}

start();