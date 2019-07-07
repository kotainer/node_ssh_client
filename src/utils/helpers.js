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

// [-L [bind_address:]port:host:hostport]
function parseForwardConfig(paramsString) {
  if (!paramsString.match(/\d{1,}:\d{1,3}.\d{1,3}.\d{1,3}.\d{1,3}:\d{1,}$/)) {
    throw new Error('Invalid forward params');
  }

  const elems = paramsString.split(':');
  
  const localHost = elems.length === 4 ? elems[0] : '::1';
  const localPort = elems.length === 4 ? elems[1] : elems[0];
  const forwardHost = elems.length === 4 ? elems[2] : elems[1];
  const forwardPort = elems.length === 4 ? elems[3] : elems[2];

  return {
    localHost,
    localPort,
    forwardHost,
    forwardPort,
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
  parseForwardConfig,
}