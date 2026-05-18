// 用户详情（已修改为 eapi 移动端模式，尝试获取 IP 属地）
const createOption = require('../util/option.js')

module.exports = async (query, request) => {
  // 1. 移动端 eapi 习惯将参数放在 data 体中，键名通常是 userId
  const data = {
    userId: query.uid,
  }

  const res = await request(
    '/api/v1/user/detail',         // 2. 修改为移动端标准的固定 API 路径
    data,                         // 3. 将携带 uid 的 data 传进去
    createOption(query, 'eapi'),  // 4. 将加密模式从 weapi 改为 eapi
  )

  const result = JSON.stringify(res).replace(
    /avatarImgId_str/g,
    'avatarImgIdStr',
  )
  return JSON.parse(result)
}
