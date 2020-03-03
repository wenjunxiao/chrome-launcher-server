const extensionId = chrome.runtime.id;
document.addEventListener(extensionId, function (event) {
  if (event.detail) {
    chrome.runtime.sendMessage(event.detail.data, (response) => {
      if (event.detail.channel) {
        document.dispatchEvent(new CustomEvent(event.detail.channel, {
          detail: {
            ref: event.detail.id,
            data: response
          }
        }))
      }
    });
  }
});

const script = document.createElement('script')
script.src = chrome.extension.getURL('inject.js')
const el = document.head || document.documentElement
el.appendChild(script)
script.onload = () => {
  script.dispatchEvent(new CustomEvent('injected', {
    detail: {
      extensionId
    }
  }))
  script.remove();
}
