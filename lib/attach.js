/**
 * attach.js —— 截图/证据图持久化到 harness attachments 的统一助手。
 *
 * 全部图片落盘走这一个出口：调用方负责 attachments 服务的取用与缺失时的
 * 具体报错文案（各路径语义不同），本助手只负责 saveImage + 输出块装配。
 * 输出块形状与 index.js 的 IMAGE_FIELD schema 严格一致。
 */

/**
 * @param {object|null} attachments - ctx.get('attachments') 服务（调用方判定缺失语义）
 * @param {{data:Buffer, mediaType:string, name:string}} input
 * @param {{width?:number, height?:number}} [dims] - ref 未带尺寸时的回退值（通常为原始截图尺寸）
 * @returns {Promise<{attachmentId:string, mediaType:string, bytes:number, width?:number, height?:number, name?:string}>}
 */
export async function saveImageAttachment(attachments, { data, mediaType, name }, dims = {}) {
  const ref = await attachments.saveImage({ data, mediaType, name })
  return {
    attachmentId: ref.attachmentId,
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    ...(ref.width != null ? { width: ref.width } : dims.width != null ? { width: dims.width } : {}),
    ...(ref.height != null ? { height: ref.height } : dims.height != null ? { height: dims.height } : {}),
    ...(ref.name != null ? { name: ref.name } : {}),
  }
}
