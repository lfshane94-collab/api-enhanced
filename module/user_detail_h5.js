'use strict'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 ' +
  'Mobile/15E148 Safari/604.1'

module.exports = (query, request) => {
  const uid = String(query.uid || '').trim()

  if (!/^\d+$/.test(uid)) {
    return Promise.resolve({
      status: 400,
      body: {
        code: 400,
        message: 'uid 参数错误',
      },
    })
  }

  /**
   * query.cookie 通常由 NeteaseCloudMusicApi 内部解析得到。
   * 如果你配置了登录 Cookie，最好在服务端配置，不要写在前端页面里。
   */
  const cookie = query.cookie || {}

  /**
   * 模拟移动端 / H5 环境
   */
  cookie.os = cookie.os || 'ios'
  cookie.appver = cookie.appver || '9.1.20'
  cookie.channel = cookie.channel || 'netease'

  const data = {
    userId: uid,
    csrf_token: cookie.__csrf || '',
  }

  /**
   * 重点：
   * 1. 使用 interface.music.163.com
   * 2. 使用 eapi
   * 3. 使用 mobile UA
   * 4. Referer 指向 H5 用户页
   */
  return request(
    'POST',
    `https://interface.music.163.com/eapi/v1/user/detail/${uid}`,
    data,
    {
      crypto: 'eapi',

      /**
       * eapi 加密时使用的接口路径
       * 这里通常对应 /api/v1/user/detail/:uid
       */
      url: `/api/v1/user/detail/${uid}`,

      ua: 'mobile',
      cookie,

      headers: {
        'User-Agent': MOBILE_UA,
        Referer: `https://y.music.163.com/m/user?id=${uid}`,
        Origin: 'https://y.music.163.com',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    },
  )
}
