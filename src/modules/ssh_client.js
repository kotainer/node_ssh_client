const ora = require('ora');
const SSH2 = require('ssh2').Client;;
const readline = require('readline');
const appRoot = require('app-root-path');

const {
  getTimeString,
  ensureDownloadDir,
} = require('../utils/helpers');

class SSHClient {
  constructor(config) {
    this.spinner = ora();
    this.connection = null;
    this.stream = null;
    this.config = config;
    this.rl = readline.createInterface(process.stdin, process.stdout);
    this.downloadPath = appRoot.path + '/downloads';

    this.connect();
  }

  async connect() {
    console.log(`${getTimeString()} Connecting to ${this.config.host}`);

    this.spinner.start();
    this.connection = new SSH2();
    this.connection.connect(this.config);

    this.connection.on('ready', () => {
      this.spinner.stop();
      console.log(`${getTimeString()} Connection successful`);
      this.openShell();
    });
  }

  openShell() {
    this.connection.shell((err, stream) => {
      if (err) throw err;
      this.stream = stream;

      this.stream
        .on('close', () => {
          this.exit()
        })
        .on('data', (data) => {
          process.stdin.pause();
          process.stdout.write(data);
          process.stdin.resume();
        })
        .stderr.on('data', (data) => {
          process.stderr.write(data);
        });

      this.rl.on('line', (line) => {
        const clearLine = line.trim();

        if (clearLine.startsWith('get ')) {
          this.getFile(clearLine.replace('get ', ''));
        } else {
          this.stream.write(clearLine + '\n');
        }
      })

      this.rl.on('SIGINT', () => {
        // this.stream.write('\x03');
        this.exit();
      })
    });
  }

  exit() {
    console.log(`${getTimeString()} Connection closed`);
    this.connection.end();
    process.exit(0);
  }

  async getSFTP() {
    return new Promise((resolve) => {
      this.connection.sftp((err, sftp) => {
        if (err) throw err;

        resolve(sftp);
      });
    })
  }

  async getFile(fileName) {
    const currentRemotePath = await this.exec('pwd');
    console.log(`${getTimeString()} Downloading from ${this.config.host}:${currentRemotePath}/${fileName} to 127.0.0.1:/${this.downloadPath}/${fileName}`);
    this.spinner.start();
    const sftp = await this.getSFTP();

    await ensureDownloadDir(this.downloadPath);
    await new Promise((resolve) => {
      sftp.fastGet(`${currentRemotePath}/${fileName}`, `${this.downloadPath}/${fileName}`, (e) => {
        if (e) throw e;

        resolve();
      })
    });

    this.spinner.stop();
    console.log(`${getTimeString()} File is downloaded successfully`);
    this.stream.write('false\n');
  }

  async exec(command, options = {}) {
    return new Promise((resolve) => {
      this.connection.exec(command, options, (err, channel) => {
        if (err) throw err;
        let result = '';

        channel.on('data', (chunk) => {
          result += chunk;
        });

        channel.on('close', () => {
          resolve(result.replace('\n', ''));
        });
      });
    });
  }
}

module.exports = SSHClient;