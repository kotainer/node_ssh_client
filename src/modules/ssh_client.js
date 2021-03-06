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
   * @param {object} options.forwardOut - Активация проброса портов на удаленный сервер
   * @param {string} options.forwardOut.localHost - Локальный хост для проброса
   * @param {string} options.forwardOut.localPort - Локальный порт для проброса
   * @param {string} options.forwardOut.forwardHost - Удалённый хост для проброса
   * @param {string} options.forwardOut.forwardPort - Удалённый порт для проброса
   * @param {object} options.forwardIn - Активация проброса портов с удалённого
   * @param {string} options.forwardIn.localHost - Локальный хост для проброса
   * @param {string} options.forwardIn.localPort - Локальный порт для проброса
   * @param {string} options.forwardIn.forwardHost - Удалённый хост для проброса
   * @param {string} options.forwardIn.forwardPort - Удалённый порт для проброса
   */
  constructor(config, options = {}) {
    this.spinner = ora();
    this.connection = null;
    this.stream = null;
    this.forwardOutServer = null;
    this.forwardInSocket = null;
    this.config = config;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: this.completer
    });
    this.downloadPath = appRoot.path + '/downloads';
    this.isInternalOut = false;
    this.internalCb = null;
    this.arrowButton = [
      'up', 'down', 'left', 'right',
    ]

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

      this.connection.on('error', (err) => {
        this.spinner.stop();
        this.exit(`[ERROR] ${err.message}`);
      });
    } catch (e) {
      this.exit(`[ERROR] ${e.message}`);
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
          if (this.isInternalOut) {
            return this.internalCb('' + data);
          }

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

      process.stdin.on('keypress', (s, key) => {
        if (this.arrowButton.includes(key.name) || key.ctrl || key.meta) {
          this.stream.write(key.sequence);
        }
      });
    });
  }

  exit(message) {
    if (message) {
      process.stdout.write(`${getTimeString()} ${message} \n`);
    }

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
      const currentRemotePath = await this.getCurrentDir();
      process.stdout.write(`${getTimeString()} Downloading from ${this.config.host}:${currentRemotePath}/${fileName} to 127.0.0.1:${this.downloadPath}/${fileName}\n`);
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
      const currentRemotePath = await this.getCurrentDir();
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

  async getCurrentDir() {
    return new Promise((resolve) => {
      this.isInternalOut = true;
      this.stream.write('pwd\n');

      this.internalCb = (data) => {
        this.isInternalOut = false;
        return resolve(data.substring(0, data.indexOf('\n')).replace('\r', ''));
      };
    }) 
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
    this.connection.forwardIn(forwardHost, forwardPort, (err) => {
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

  completer(line) {
    const commandlist = ['get', 'put'];
    const hits = commandlist.filter(c => c.startsWith(line));

    // show all completions if none found
    return [hits.length ? hits : commandlist, line];
  }
}

module.exports = SSHClient;