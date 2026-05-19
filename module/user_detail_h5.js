// 用户详情 H5 模拟版
// 路由：/user/detail/h5?uid=xxxx

const createOption = require('../util/option.js')

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 ' +
  'Mobile/15E148 Safari/604.1'

function parseCookie(cookie) {
  if (!cookie) return {}

  if (typeof cookie === 'object') {
    return { ...cookie }
  }

  return String(cookie)
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((obj, item) => {
      const index = item.indexOf('=')
      if (index === -1) return obj

      const key = item.slice(0, index).trim()
      const value = item.slice(index + 1).trim()

      if (key) obj[key] = value
      return obj
    }, {})
}

function normalizeIpLocation(value) {
  if (!value) return ''

  if (typeof value === 'string') {
    return value
      .replace(/^IP属地[:：]?\s*/i, '')
      .replace(/^IP[:：]?\s*/i, '')
      .trim()
  }

  if (typeof value === 'object') {
    return (
      value.location ||
      value.province ||
      value.city ||
      value.region ||
      value.country ||
      ''
    )
  }

  return ''
}

function findIpLocation(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return ''

  if (Object.prototype.hasOwnProperty.call(obj, 'ipLocation')) {
    const result = normalizeIpLocation(obj.ipLocation)
    if (result) return result
  }

  const likelyKeys = [
    'profile',
    'userProfile',
    'userInfo',
    'user',
    'data',
    'homePage',
    'homepage',
    'account',
  ]

  for (const key of likelyKeys) {
    if (obj[key]) {
      const result = findIpLocation(obj[key], depth + 1)
      if (result) return result
    }
  }

  if (depth <= 3) {
    for (const key in obj) {
      if (obj[key] && typeof obj[key] === 'object') {
        const result = findIpLocation(obj[key], depth + 1)
        if (result) return result
      }
    }
  }

  return ''
}

function getBody(res) {
  return res && res.body ? res.body : res
}

function makeH5Option(query, uid, apiPath, cookie, crypto = 'eapi') {
  const option = createOption(
    {
      ...query,
      cookie,
      ua: 'mobile',
    },
    crypto,
  )

  option.crypto = crypto
  option.ua = 'mobile'

  /**
   * eapi 加密时使用的接口路径。
   * 对于 interface.music.163.com/eapi/xxx，
   * 这里通常要写成 /api/xxx。
   */
  option.url = apiPath

  /**
   * 注意：
   * 如果你的 util/request.js 没有合并 options.headers，
   * 这里的 headers 不会生效。
   * 下面第二部分会讲怎么改 request.js。
   */
  option.headers = {
    ...(option.headers || {}),
    'User-Agent': MOBILE_UA,
    Referer: `https://y.music.163.com/m/user?id=${uid}`,
    Origin: 'https://y.music.163.com',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'X-Requested-With': 'XMLHttpRequest',
  }

  return option
}

module.exports = async (query, request) => {
  const uid = String(query.uid || '').trim()

  if (!/^\d+$/.test(uid)) {
    return {
      code: 400,
      msg: 'uid 参数错误',
    }
  }

  /**
   * 不建议把 Cookie 写在前端传过来。
   * 如果需要 Cookie，建议在服务端环境变量里配置：
   *
   * NCM_COOKIE="MUSIC_U=xxx; __csrf=xxx"
   */
  const envCookie = parseCookie(process.env.NCM_COOKIE || '')
  const queryCookie = parseCookie(query.cookie || '')
  const cookie = {
    ...envCookie,
    ...queryCookie,
  }

  /**
   * 模拟移动端环境。
   */
  cookie.os = cookie.os || 'ios'
  cookie.appver = cookie.appver || '9.1.70'
  cookie.channel = cookie.channel || 'netease'

  /**
   * 这里先尝试几个可能的 H5 / eapi 形式。
   * 如果你之后在浏览器 Network 里抓到了真正接口，
   * 主要就是改这里的 targets。
   */
  const targets = [
    {
      name: 'h5-w-detail-relative',
      apiPath: `/api/w/v1/user/detail/${uid}`,
      requestUrl: `/api/w/v1/user/detail/${uid}`,
      crypto: 'eapi',
      data: {
        all: 'true',
        userId: uid,
        csrf_token: cookie.__csrf || '',
      },
    },
    {
      name: 'h5-w-detail-interface',
      apiPath: `/api/w/v1/user/detail/${uid}`,
      requestUrl: `https://interface.music.163.com/eapi/w/v1/user/detail/${uid}`,
      crypto: 'eapi',
      data: {
        all: 'true',
        userId: uid,
        csrf_token: cookie.__csrf || '',
      },
    },
    {
      name: 'h5-v1-detail-interface',
      apiPath: `/api/v1/user/detail/${uid}`,
      requestUrl: `https://interface.music.163.com/eapi/v1/user/detail/${uid}`,
      crypto: 'eapi',
      data: {
        csrf_token: cookie.__csrf || '',
      },
    },
  ]

  let firstResult = null
  let firstBody = null
  const attempts = []

  for (const target of targets) {
    try {
      const option = makeH5Option(
        query,
        uid,
        target.apiPath,
        cookie,
        target.crypto,
      )

      const res = await request(target.requestUrl, target.data, option)
      const body = getBody(res)
      const ipLocation = findIpLocation(body)

      attempts.push({
        name: target.name,
        code: body && body.code,
        ipLocation,
      })

      if (!firstResult) {
        firstResult = res
        firstBody = body
      }

      /**
       * 如果某个接口拿到了 IP 属地，直接返回这个结果。
       */
      if (ipLocation) {
        if (String(query.debug) === '1') {
          return {
            code: 200,
            uid,
            selected: target.name,
            ipLocation,
            attempts,
            result: body,
          }
        }

        return res
      }
    } catch (error) {
      attempts.push({
        name: target.name,
        error: error.message || String(error),
      })
    }
  }

  /**
   * 没拿到 IP，但至少有接口返回了用户信息。
   */
  if (firstResult) {
    if (String(query.debug) === '1') {
      return {
        code: 200,
        uid,
        msg: '接口可用，但没有找到 ipLocation',
        attempts,
        result: firstBody,
      }
    }

    return firstResult
  }

  return {
    code: 502,
    uid,
    msg: 'H5 模拟请求失败',
    attempts,
  }
}
