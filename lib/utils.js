const fs = require('fs');
const path = require('path');

function writeFile (filename, data, options) {
  return new Promise((resolve, reject) => {
    fs.writeFile(filename, data, options || {}, err => {
      if (err) return reject(err);
      return resolve(filename);
    });
  });
}

function ensureDir (dir) {
  return new Promise((resolve, reject) => {
    fs.exists(dir, exists => {
      if (exists) return resolve(dir);
      ensureDir(path.dirname(dir)).then(() => {
        fs.mkdir(dir, err => {
          if (err && err.code !== 'EEXIST') return reject(err);
          return resolve(dir);
        });
      });
    });
  });
}

function readFile (filename, error = true) {
  return new Promise((resolve, reject) => {
    fs.readFile(filename, (err, buffer) => {
      if (err && error) return reject(err);
      return resolve(buffer);
    });
  })
}

function getFileSize (filename) {
  return new Promise(resolve => {
    fs.stat(filename, (err, stat) => {
      if (err) return resolve(0);
      return resolve(stat.size);
    });
  })
}


function readdir (dir) {
  return new Promise((resolve, reject) => {
    fs.readdir(dir, (err, files) => {
      if (err) return reject(err)
      return resolve(files)
    })
  })
}

function unlink (path) {
  return new Promise((resolve, reject) => {
    fs.unlink(path, (err) => {
      if (err) return reject(err)
      return resolve()
    })
  })
}

function rmdir (dir) {
  return new Promise((resolve, reject) => {
    return fs.rmdir(dir, (err) => {
      if (err) return reject(err)
      return resolve()
    })
  })
}

function stat (path) {
  return new Promise((resolve, reject) => {
    return fs.stat(path, (err, stats) => {
      if (err) return reject(err)
      return resolve(stats)
    })
  })
}

function rmdirp (dir) {
  return stat(dir).then(stats => {
    if (stats.isDirectory()) {
      return readdir(dir).then(files => {
        return Promise.all(files.map(file => rmdirp(path.resolve(dir, file))))
      }).then(() => {
        return rmdir(dir)
      })
    } else {
      return unlink(dir)
    }
  })
}

module.exports = {
  unlink,
  rmdirp,
  getFileSize,
  readFile,
  writeFile,
  ensureDir
}