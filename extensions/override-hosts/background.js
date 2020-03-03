const FILTER = { urls: ['<all_urls>'] };
const settings = {
  enabled: true,
  hosts: {
    // 'www.example.local': {
    //   ip: '127.0.0.1'
    // }
  },
};
const pendings = {};
function onBeforeRequest (details) {
  const url = details.url;
  if (settings.enabled && /^(\w+:\/\/)([^:\/]+)([\s\S]*)$/.test(url)) {
    const prefix = RegExp.$1;
    const domain = RegExp.$2;
    const suffix = RegExp.$3;
    const cfg = settings.hosts[domain];
    if (settings.hosts[domain]) {
      if (!cfg.domain) {
        cfg.domain = domain;
      }
      pendings[details.requestId] = cfg;
      return {
        redirectUrl: prefix + cfg.ip + suffix
      }
    }
  }
}

function onBeforeSendHeaders (details) {
  if (settings.enabled && pendings[details.requestId]) {
    const cfg = pendings[details.requestId];
    delete pendings[details.requestId];
    details.requestHeaders.push({ name: 'Host', value: cfg.domain });
    return { requestHeaders: details.requestHeaders };
  }
}
chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, FILTER, ['blocking']);
chrome.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, FILTER, ['requestHeaders']);

function onMessage (message, sender, sendResponse) {
  if (message) {
    if (message.action === 'set') {
      if (message.settings && typeof message.settings === 'object') {
        Object.assign(settings, message.settings);
      }
      sendResponse({ success: true });
    } else if (message.action === 'get') {
      sendResponse({ success: true, data: settings });
    } else {
      sendResponse({ success: false });
    }
  } else {
    sendResponse();
  }
}
chrome.runtime.onMessage.addListener(onMessage);
chrome.runtime.onMessageExternal.addListener(onMessage);
