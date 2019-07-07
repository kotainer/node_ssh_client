const ora = require('ora');
const SSH2 = require('ssh2').Client;;
const readline = require('readline');
const appRoot = require('app-root-path');
const fs = require('fs');
const path = require('path');
const net = require('net');

const {
  getTimeString,
  ensureDownloadDir,
} = require('../utils/helpers');

class SSHClient {
  /**
   * Создает SSH подключение.
   *
   * @constructor
   * @this  {SSHClient}
   * @param {object} config - Конфиг подключения
   * @param {object} options - Дополнительные параметры
   * @param {object} options.forwardOut - Активация проброса портов
   * @param {object} options.forwardOut.localHost - Локальный хост для проброса
   * @param {object} options.forwardOut.localPort - Локальный порт для проброса
   * @param {object} options.forwardOut.forwardHost - Удалённый хост для проброса
   * @param {object} options.forwardOut.forwardPort - Удалённый порт для проброса
   */
  constructor(config, options = {}) {
    this.spinner = ora();
    this.connection = null;
    this.stream = null;
    this.forwardOutServer = null;
    this.forwardInSocket = null;
    this.config = config;
    this.rl = readline.createInterface(process.stdin);
    this.downloadPath = appRoot.path + '/downloads';

    this.connect(options);
  }

  async connect(options) {
    try {
      process.stdout.write(`${getTimeString()} Connecting to ${this.config.host}\n`);

      this.spinner.start();
      this.connection = new SSH2();
      this.connection.connect(this.config);

      this.connection.on('ready', () => {
        this.spinner.stop();
        process.stdout.write(`${getTimeString()} Connection successful\n`);
        this.openShell();

        if (options && options.forwardOut) {
          this.forwardOut(options.forwardOut);
        }

        if (options && options.forwardIn) {
          this.forwardIn(options.forwardIn);
        }
      });
    } catch (e) {
      process.stdout.write(`${getTimeString()} ERROR ${e.message}\n`);
    }
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
        this.stream.write('\x03');
        // this.exit();
      })
    });
  }

  exit(message) {
    process.stdout.write(`${getTimeString()} Connection closed\n`);
    this.connection.end();

    if (this.forwardOutServer) {
      this.forwardOutServer.close();
    }

    if (this.forwardOutSock) {
      this.forwardOutSock.end();
    }

    if (this.forwardInSocket) {
      this.forwardInSocket.end();
    }

    if (message) {
      process.stdout.write(`${getTimeString()} ${message} \n`);
    }

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

  forwardOut({
    localHost = '::1',
    localPort,
    forwardHost,
    forwardPort,
  }) {
    if (!localPort || !forwardHost || !forwardPort) {
      return this.exit('Missed forwarding params');
    }

    this.forwardOutServer = net.createServer((sock) => {
      this.forwardOutSock = sock;
      this.connection.forwardOut(sock.remoteAddress,
        sock.remotePort,
        forwardHost,
        forwardPort,
        (err, stream) => {
          if (err) {
            return this.exit(`Error forwarding connection: ${err.message}`);
          }

          sock.pipe(stream).pipe(sock);
        });
    });

    this.forwardOutServer.listen(localPort, localHost);

    this.forwardOutServer.on('error', (err) => {
      return this.exit(`Error forwarding connection: ${err.message}`);
    });
  }

  forwardIn({
    localHost = '127.0.0.1',
    localPort,
    forwardHost,
    forwardPort,
  }) {
    this.connection.forwardIn(forwardHost, forwardPort, (err, port) => {
      if (err) {
        return this.exit(`Error forwarding connection: ${err.message}`);
      }

      this.connection.on('tcp connection', (info, accept) => {
        this.forwardInSocket = new net.Socket();
        this.forwardInSocket.connect(localPort, localHost, (err) => {
          if (err) {
            return this.exit(`Error forwarding connection: ${err.message}`);
          }

          const remote = accept();
          this.forwardInSocket.pipe(remote).pipe(this.forwardInSocket);
        });

        this.forwardInSocket.on('error', (err) => {
          return this.exit(`Error forwarding connection: ${err.message}`);
        });
      });
    });
  }
}

module.exports = SSHClient;