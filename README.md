# chrome-launcher-server
> chrome-launcher manager server.

## Install

```bash
$ npm install -g chrome-launcher-server
```

## Usage

  Run server in command line.
```bash
$ chrome-server [options]
```

### Options

 Show all options

```bash
$ chrome-server --help
  Usage: chrome-server [options]

  Options:

    -V, --version              output the version number
    -h, --host [host]          listen address
    -p, --port [port]          listen port
    -v, --verbose              verbose
    -c, --config [configFile]  config file to load
    -h, --help                 output usage information
```

  Configuration file
```js
{
  port: 5101,
  host: '0.0.0.0',
  log4js: {
    ... // log4js configuration
  }
}
```