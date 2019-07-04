const fse = require('fs-extra');

function parseConfig(connetionString) {
  if (!connetionString.match(/^\w{1,}:\S{1,}@\d{1,3}.\d{1,3}.\d{1,3}.\d{1,3}$/)) {
    throw new Error('Invalid connection params');
  }

  return {
    host: connetionString.match(/\d{1,3}.\d{1,3}.\d{1,3}.\d{1,3}$/)[0],
    username: connetionString.match(/^\w{1,}/)[0],
    password: connetionString.match(/:\S{1,}@/)[0].slice(1, -1),
    privateKey: '',
    port: 22,
  }
}

function getTimeString() {
  const now = new Date();

  return `[${tensCheck(now.getHours())}:${tensCheck(now.getMinutes())}:${tensCheck(now.getSeconds())}]`;
}

function tensCheck(number) {
  if (number < 10) {
    return `0${number}`;
  }

  return number;
}

async function ensureDownloadDir(path) {
  try {
    await fse.ensureDir(path);
  } catch (err) {
    console.error(err)
  }
}

module.exports = {
  parseConfig,
  getTimeString,
  ensureDownloadDir,
}