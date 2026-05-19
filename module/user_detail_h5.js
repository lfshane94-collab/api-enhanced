// 用户详情 H5 增强版
// 路由：/user/detail/h5?uid=xxxx
//
// 作用：
// 1. 请求用户基础信息
// 2. 请求 H5 页面实际使用的 /weapi/user/tag/list
// 3. 从 tags 里提取 specialCode === 'ip' 的 IP 属地
// 4. 合并到 profile.ipLocation

const createOption = require('../util/option.js')

const INTERFACE_DOMAIN = 'https://interface.music.163.com'

const MOBILE_H5_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.2 ' +
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

function mergeCookie(option, query) {
  const envCookie = parseCookie(process.env.NCM_COOKIE || '')
  const optionCookie = parseCookie(option.cookie || {})
  const queryCookie = parseCookie(query.cookie || '')

  return {
    ...envCookie,
    ...optionCookie,
    ...queryCookie,
  }
}

function getBody(res) {
  return res && res.body ? res.body : res
}

function errorMessage(error) {
  if (!error) return '未知错误'

  if (error.body) {
    return (
      error.body.msg ||
      error.body.message ||
      error.body.error ||
      JSON.stringify(error.body)
    )
  }

  return error.message || String(error)
}

function extractIpFromTagList(body) {
  const tags =
    body?.data?.tags ||
    body?.tags ||
    body?.result?.data?.tags ||
    []

  if (!Array.isArray(tags)) return ''

  const ipTag = tags.find((tag) => {
    const specialCode = String(tag?.specialCode || '').toLowerCase()
    const name = String(tag?.name || '')

    return specialCode === 'ip' || /^IP\s*[:：]/i.test(name)
  })

  if (!ipTag) return ''

  const name = String(ipTag.name || '')

  const match =
    name.match(/^IP\s*[:：]\s*(.+)$/i) ||
    name.match(/^IP属地\s*[:：]\s*(.+)$/i)

  if (match && match[1]) {
    return match[1].trim()
  }

  return name
    .replace(/^IP\s*[:：]\s*/i, '')
    .replace(/^IP属地\s*[:：]\s*/i, '')
    .trim()
}

function injectIpLocationToDetail(detailBody, ipLocation) {
  if (!detailBody || typeof detailBody !== 'object' || !ipLocation) {
    return detailBody
  }

  if (detailBody.profile && typeof detailBody.profile === 'object') {
    detailBody.profile.ipLocation = {
      location: ipLocation,
      source: 'user_tag_list',
    }

    return detailBody
  }

  if (
    detailBody.data &&
    detailBody.data.profile &&
    typeof detailBody.data.profile === 'object'
  ) {
    detailBody.data.profile.ipLocation = {
      location: ipLocation,
      source: 'user_tag_list',
    }

    return detailBody
  }

  detailBody.ipLocation = {
    location: ipLocation,
    source: 'user_tag_list',
  }

  return detailBody
}

async function fetchDetail(query, request, uid) {
  const option = createOption(query, 'eapi')

  option.cookie = mergeCookie(option, query)

  option.cookie.os = option.cookie.os || 'iPhone OS'
  option.cookie.osver = option.cookie.osver || '16.2'
  option.cookie.appver = option.cookie.appver || '9.1.70'
  option.cookie.channel = option.cookie.channel || 'distribution'

  option.ua = MOBILE_H5_UA

  option.headers = {
    ...(option.headers || {}),
    Referer: `https://y.music.163.com/m/user?id=${uid}`,
    Origin: 'https://y.music.163.com',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'User-Agent': MOBILE_H5_UA,
  }

  const data = {
    all: 'true',
    userId: uid,
    csrf_token: option.cookie.__csrf || '',
  }

  return request(`/api/w/v1/user/detail/${uid}`, data, option)
}

async function fetchUserTagList(query, request, uid) {
  const option = createOption(query, 'weapi')

  option.domain = INTERFACE_DOMAIN
  option.cookie = mergeCookie(option, query)
  option.ua = MOBILE_H5_UA
  option.e_r = false

  const csrf = option.cookie.__csrf || query.csrf_token || ''

  option.headers = {
    ...(option.headers || {}),
    Referer: `https://y.music.163.com/m/user?id=${uid}`,
    Origin: 'https://y.music.163.com',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'User-Agent': MOBILE_H5_UA,
    'X-Requested-With': 'XMLHttpRequest',
  }

  /**
   * 你抓到的是：
   * https://interface.music.163.com/weapi/user/tag/list?csrf_token=xxx
   *
   * 在这个 request.js 里，weapi 应该传 /api/user/tag/list，
   * request.js 会自动转换成 /weapi/user/tag/list。
   */
  const uri = `/api/user/tag/list${
    csrf ? `?csrf_token=${encodeURIComponent(csrf)}` : ''
  }`

  /**
   * H5 页面实际请求里目标用户 ID 应该在加密后的 body 里。
   * 这里使用 userId。
   */
  const data = {
    userId: uid,
    csrf_token: csrf,
  }

  return request(uri, data, option)
}

module.exports = async (query, request) => {
  const uid = String(query.uid || query.userId || '').trim()

  if (!/^\d+$/.test(uid)) {
    return {
      status: 400,
      body: {
        code: 400,
        msg: 'uid 参数错误',
      },
      cookie: [],
    }
  }

  let detailRes = null
  let detailBody = null
  let tagBody = null
  let ipLocation = ''
  let detailError = ''
  let tagError = ''

  try {
    detailRes = await fetchDetail(query, request, uid)
    detailBody = getBody(detailRes)
  } catch (error) {
    detailError = errorMessage(error)
  }

  try {
    const tagRes = await fetchUserTagList(query, request, uid)
    tagBody = getBody(tagRes)
    ipLocation = extractIpFromTagList(tagBody)
  } catch (error) {
    tagError = errorMessage(error)
  }

  /**
   * debug=1 时，返回详细调试信息，方便确认 IP 是否来自 tag/list。
   */
  if (String(query.debug) === '1') {
    return {
      status: 200,
      body: {
        code: 200,
        uid,
        ipLocation,
        detailError,
        tagError,
        detail: detailBody,
        tagList: tagBody,
      },
      cookie: detailRes?.cookie || [],
    }
  }

  /**
   * 如果 detail 成功，则把 IP 合并进去再返回。
   */
  if (detailRes && detailBody) {
    injectIpLocationToDetail(detailBody, ipLocation)

    return detailRes
  }

  /**
   * 如果 detail 失败，但 tag/list 拿到了 IP，也返回一个可识别结构。
   */
  if (ipLocation) {
    return {
      status: 200,
      body: {
        code: 200,
        profile: {
          userId: Number(uid),
          ipLocation: {
            location: ipLocation,
            source: 'user_tag_list',
          },
        },
        tagList: tagBody,
      },
      cookie: [],
    }
  }

  return {
    status: 502,
    body: {
      code: 502,
      uid,
      msg: 'H5 用户详情和用户标签均获取失败',
      detailError,
      tagError,
    },
    cookie: [],
  }
}
