const channel = 'HOST.' + Date.now().toString(36) + '.' + Math.random().toString(36).substr(2);
const callbacks = {};
const pendings = [];
let reqId = 0;
let extensionId = 0;

document.currentScript.addEventListener('injected', (event) => {
  if (event.detail && event.detail.extensionId) {
    extensionId = event.detail.extensionId;
    while (pendings.length > 0) {
      const req = pendings.shift();
      request(req.data, req.callback);
    }
  }
})

document.addEventListener(channel, function (event) {
  if (event.detail) {
    if (event.detail.ref) {
      const callback = callbacks[event.detail.ref];
      delete callbacks[event.detail.ref];
      if (callback) {
        callback(event.detail.data);
      }
    }
  }
})

function request (data, callback) {
  if (extensionId) {
    const id = ++reqId;
    callbacks[id] = callback;
    document.dispatchEvent(new CustomEvent(extensionId, {
      detail: {
        id,
        channel,
        data
      }
    }));
  } else {
    pendings.push({
      data,
      callback
    });
  }
}
window.overrideHosts = {
  request
};
