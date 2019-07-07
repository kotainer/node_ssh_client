const ora = require('ora');
const SSH2 = require('ssh2').Client;;
const readline = require('readline');
const appRoot = require('app-root-path');
const fs = require('fs')
const path = require('path')

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
    this.rl = readline.createInterface(process.stdin);
    this.downloadPath = appRoot.path + '/downloads';

    this.connect();
  }

  async connect() {
    process.stdout.write(`${getTimeString()} Connecting to ${this.config.host}\n`);

    this.spinner.start();
    this.connection = new SSH2();
    this.connection.connect(this.config);

    this.connection.on('ready', () => {
      this.spinner.stop();
      process.stdout.write(`${getTimeString()} Connection successful\n`);
      this.openShell();
    });
  }

  openShell() {
    this.connection.shell((err, stream) => {
      if (err) throw err;
      this.stream = stream;
      this.stream.write('stty -echo\n');

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
        } else if (clearLine.startsWith('put ')) {
          this.putFile(clearLine.replace('put ', ''));
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
    process.stdout.write(`${getTimeString()} Connection closed\n`);
    this.connection.end();
    process.exit(0);
  }

  async getSFTP() {
    return new Promise((resolve) => {
      this.connection.sftp((err, sftp) => {
        if (err) {
          throw new Error(err);
        }

        resolve(sftp);
      });
    })
  }

  async getFile(fileName) {
    try {
      const currentRemotePath = await this.exec('pwd');
      process.stdout.write(`${getTimeString()} Downloading from ${this.config.host}:${currentRemotePath}/${fileName} to 127.0.0.1:/${this.downloadPath}/${fileName}\n`);
      this.spinner.start();
      const sftp = await this.getSFTP();

      await ensureDownloadDir(this.downloadPath);
      await new Promise((resolve, reject) => {
        sftp.fastGet(`${currentRemotePath}/${fileName}`, `${this.downloadPath}/${fileName}`, (e) => {
          this.spinner.stop();
          if (e) {
            return reject(e)
          }

          process.stdout.write(`${getTimeString()} File is downloaded successfully\n`);
          resolve();
        })
      }).catch((e) => {
        this.spinner.stop();
        if (e && e.message === 'No such file') {
          process.stdout.write(`${getTimeString()} No such file ${currentRemotePath}/${fileName}\n`);
        }
      });

      this.stream.write('false\n');
    } catch (e) {
      console.error(e);
    }
  }

  async putFile(filePath) {
    try {
      const currentRemotePath = await this.exec('pwd');
      const fileName = path.basename(filePath);

      process.stdout.write(`${getTimeString()} Uploading ${filePath} to ${this.config.host}:${currentRemotePath}/${fileName}\n`);
      this.spinner.start();

      const sftp = await this.getSFTP();
      const readStream = fs.createReadStream(filePath);
      const writeStream = sftp.createWriteStream(`${currentRemotePath}/${fileName}`);

      await new Promise((resolve) => {
        readStream.pipe(writeStream);

        writeStream.on('close', () => {
          this.spinner.stop();
          process.stdout.write(`${getTimeString()} File uploading complete\n`);
          return resolve();
        });
      });

      this.stream.write('false\n');
    } catch (e) {
      console.error(e);
    }
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