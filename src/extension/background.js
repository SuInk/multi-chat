// 点击工具栏图标时打开聊天页；已打开则切换过去
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('index.html')
  const [tab] = await chrome.tabs.query({ url })
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true })
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true })
    }
    return
  }
  await chrome.tabs.create({ url })
})
