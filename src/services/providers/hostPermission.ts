/**
 * 作为浏览器扩展运行时，页面要先拿到目标域名的 host 权限，fetch 才能绕过跨域限制。
 * 只能在用户点击的同一调用栈里申请（之前不能有 await），所以由按钮点击直接调用。
 * 普通网页里没有 chrome.permissions，直接返回 true。
 */
type PermissionsApi = {
  request: (permissions: { origins: string[] }) => Promise<boolean>
  contains: (permissions: { origins: string[] }) => Promise<boolean>
}

const getPermissionsApi = (): PermissionsApi | undefined =>
  (globalThis as { chrome?: { permissions?: PermissionsApi } }).chrome?.permissions

export const isExtension = () => getPermissionsApi() !== undefined

export const requestHostPermission = (baseUrl: string): Promise<boolean> => {
  const permissions = getPermissionsApi()
  if (!permissions) {
    return Promise.resolve(true)
  }
  let origin: string
  try {
    origin = new URL(baseUrl).origin
  } catch {
    return Promise.resolve(false)
  }
  return permissions.request({ origins: [`${origin}/*`] }).catch(() => false)
}
